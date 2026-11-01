"""FR-SYS-001/010/014/016: isolated auth regressions; never import app.py.

Run from services/api with bytecode/cache disabled and --basetemp under repo/temp.
All users, cookies and tokens below are synthetic. No database or network is used.
"""
from __future__ import annotations

import copy
import hashlib
import importlib
import importlib.util
import logging
import os
import smtplib
import socket
import sqlite3
import ssl
import sys
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, Mock, call, patch

import httpx
import pytest
from flask import Flask
from sqlalchemy import UniqueConstraint, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import operators as sa_operators

API_DIR = Path(__file__).resolve().parent
REPO_TEMP = API_DIR.parents[1] / "temp"


def _load_module(name, filename):
    # Restore only this name: restoring all of sys.modules would unload freshly
    # imported SQLAlchemy modules while leaving their inspection registries alive.
    # Individual files never execute routes/__init__.py or app.py.
    spec = importlib.util.spec_from_file_location(name, API_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    previous = sys.modules.get(name)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        if previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous
    return module


@pytest.fixture(scope="module")
def modules():
    # Keep lazy quota imports pointed at individual route modules, never the
    # production blueprint aggregator (routes/__init__.py) or app.py.
    package = ModuleType("routes")
    package.__path__ = []
    with pytest.MonkeyPatch.context() as loader:
        loader.setitem(sys.modules, "routes", package)
        plans = _load_module("routes.plans", "routes/plans.py")
        loader.setitem(sys.modules, "routes.plans", plans)
        ocr = _load_module("routes.ocr", "routes/ocr.py")
        loader.setitem(sys.modules, "routes.ocr", ocr)
        yield SimpleNamespace(
            auth=importlib.import_module("auth"),
            routes=_load_module("auth_modes_routes", "routes/auth.py"),
            me=_load_module("auth_modes_me", "routes/me.py"),
            plans=plans,
            ocr=ocr,
            files=_load_module("auth_modes_files", "routes/files.py"),
            results=_load_module("auth_modes_results", "routes/results.py"),
            quota=importlib.import_module("quota"),
            subscriptions=importlib.import_module("subscriptions"),
            reminders=importlib.import_module("reminders"),
            workspace=importlib.import_module("workspace"),
            errors=importlib.import_module("errors"),
            models=importlib.import_module("models"),
            email_sender=importlib.import_module("email_sender"),
        )


@pytest.fixture(autouse=True)
def forbid_external_io(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Auth regressions forbid database, network and SMTP I/O")

    monkeypatch.setattr(Engine, "connect", forbidden)
    monkeypatch.setattr(Engine, "raw_connection", forbidden)
    monkeypatch.setattr(sqlite3, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket.socket, "connect_ex", forbidden)
    monkeypatch.setattr(httpx, "post", forbidden)
    monkeypatch.setattr(httpx.Client, "send", forbidden)
    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    # Patch real SMTP methods, not just constructors: even an accidentally retained
    # client cannot send. Protocol tests replace both constructors with local doubles.
    for smtp_type in (smtplib.SMTP, smtplib.SMTP_SSL):
        for name in (
            "__init__", "connect", "_get_socket", "send", "docmd", "ehlo",
            "starttls", "login", "sendmail", "send_message",
        ):
            monkeypatch.setattr(smtp_type, name, forbidden)


@pytest.fixture(autouse=True)
def plan_catalog(monkeypatch):
    """FR-SYS-019：套餐配置默认读内置种子（plans 表为空的路径），测试之间不共享缓存。"""
    catalog = importlib.import_module("plans")
    rows: list[dict] = []
    monkeypatch.setattr(catalog, "_load_rows", lambda: copy.deepcopy(rows))
    catalog.invalidate()
    yield SimpleNamespace(module=catalog, rows=rows)
    catalog.invalidate()


@pytest.fixture
def fake_db(monkeypatch, modules):
    database = SimpleNamespace(session=Mock())
    for module in (
        modules.auth, modules.routes, modules.me, modules.plans, modules.ocr,
        modules.files, modules.results, modules.quota, modules.workspace,
        modules.subscriptions, modules.reminders,
    ):
        monkeypatch.setattr(module, "db", database)
    return database


@pytest.fixture
def app(modules, fake_db):
    app = Flask(__name__, instance_path=str(REPO_TEMP))
    app.config.update(
        TESTING=True,
        AUTH_DEV_MODE=False,
        LINE_CHANNEL_ID="synthetic-channel",
        SESSION_COOKIE_NAME="saiflow_session",
        SESSION_IDLE_TTL_SECONDS=12 * 3600,
        SESSION_ABSOLUTE_TTL_SECONDS=30 * 24 * 3600,
        SESSION_COOKIE_SECURE=False,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_PATH="/api",
        ALLOWED_FILE_EXTENSIONS={"pdf", "jpg", "jpeg", "png"},
        ALLOWED_IMAGE_EXTENSIONS={"jpg", "jpeg", "png"},
        MAX_FILE_SIZE_BYTES=20 * 1024 * 1024,
        MAX_PAGES_PER_TASK=30,
    )
    app.register_error_handler(modules.errors.ApiError, modules.errors.error_response)
    app.register_blueprint(modules.routes.bp, url_prefix="/api/v1")
    app.register_blueprint(modules.me.bp, url_prefix="/api/v1")
    app.register_blueprint(modules.plans.bp, url_prefix="/api/v1")
    app.register_blueprint(modules.files.bp, url_prefix="/api/v1")
    app.register_blueprint(modules.ocr.ocr_bp, url_prefix="/api/v1")
    app.register_blueprint(modules.results.results_bp, url_prefix="/api/v1")
    return app


@pytest.fixture
def client(app):
    client = app.test_client()
    # A cookie forces a regression to fail if validation incorrectly reads a guest first.
    client.set_cookie("saiflow_session", "synthetic-cookie", path="/api")
    return client


def _user(modules, sub="U-synthetic-line", provider="line", user_id=101):
    return modules.models.User(
        id=user_id,
        line_provider=provider,
        line_sub=sub,
        status="ACTIVE",
        display_name="Synthetic User",
        avatar_url="",
        avatar_path="",
        language="en",
        phone="",
        email="synthetic@example.com",
        registered_at=None,
    )


def _tenant(
    modules, tenant_id, tenant_type="PERSONAL", owner_user_id=None,
    status="ACTIVE", name="Synthetic Tenant",
):
    return modules.models.Tenant(
        id=tenant_id,
        tenant_type=tenant_type,
        owner_user_id=owner_user_id,
        display_name=name,
        status=status,
    )


def _assert_error(response, status, code, message_key):
    assert response.status_code == status
    payload = response.get_json()
    assert payload == {
        "code": code,
        "message_key": message_key,
        "request_id": payload["request_id"],
        "retryable": status in (429, 503),
        "field_errors": [],
    }
    assert isinstance(payload["request_id"], str) and payload["request_id"]


@pytest.mark.parametrize(
    "environment, expected_env, enabled",
    [
        ({}, "production", False),
        ({"AUTH_DEV_MODE": "true"}, "production", False),
        ({"APP_ENV": "production", "AUTH_DEV_MODE": "true"}, "production", False),
        ({"APP_ENV": "staging", "AUTH_DEV_MODE": "true"}, "staging", False),
        ({"APP_ENV": "development"}, "development", False),
        ({"APP_ENV": "development", "AUTH_DEV_MODE": "true"}, "development", True),
        ({"APP_ENV": "development", "AUTH_DEV_MODE": "TRUE"}, "development", True),
        ({"APP_ENV": "development", "AUTH_DEV_MODE": "false"}, "development", False),
        ({"APP_ENV": "development", "AUTH_DEV_MODE": ""}, "development", False),
        ({"APP_ENV": "development", "AUTH_DEV_MODE": "1"}, "development", False),
        ({"APP_ENV": "development", "AUTH_DEV_MODE": "yes"}, "development", False),
        ({"APP_ENV": "development", "AUTH_DEV_MODE": "on"}, "development", False),
        ({"APP_ENV": "Development", "AUTH_DEV_MODE": "true"}, "Development", False),
        (
            {"APP_ENV": "development", "AUTH_DEV_MODE": "true", "K_SERVICE": "synthetic-service"},
            "development",
            False,
        ),
        (
            {"APP_ENV": "development", "AUTH_DEV_MODE": "true", "K_SERVICE": ""},
            "development",
            False,
        ),
    ],
)
def test_config_requires_explicit_local_development(environment, expected_env, enabled):
    # Do not read .env/.env.local or inherit credentials from the running shell.
    with patch.dict(os.environ, environment, clear=True), patch("dotenv.load_dotenv") as dotenv:
        config = _load_module("auth_modes_config", "config.py").Config
    assert config.APP_ENV == expected_env
    assert config.AUTH_DEV_MODE is enabled
    assert dotenv.call_args_list == [call(), call(".env.local")]


def test_docker_defaults_to_production():
    dockerfile = (API_DIR / "Dockerfile").read_text(encoding="utf-8")
    assert "ENV APP_ENV=production" in dockerfile.splitlines()
    assert "ENV AUTH_DEV_MODE=false" in dockerfile.splitlines()
    assert "ENV AUTH_DEV_MODE=true" not in dockerfile.splitlines()


@pytest.mark.parametrize("dev_id", ["synthetic-dev", "", None, False])
@pytest.mark.parametrize("with_token", [False, True])
def test_production_rejects_any_dev_id_before_guest_or_database(
    client, modules, fake_db, monkeypatch, dev_id, with_token
):
    routes = modules.routes
    guest = Mock()
    upsert = Mock()
    finish = Mock()
    validator = Mock()
    user_model = Mock()
    for name, mock in (
        ("_guest_context", guest),
        ("_upsert_line_user", upsert),
        ("_finish_login", finish),
        ("_verify_line_id_token", validator),
        ("User", user_model),
    ):
        monkeypatch.setattr(routes, name, mock)
    body = {"dev_id": dev_id}
    if with_token:
        body["id_token"] = "synthetic-valid-token"
    response = client.post("/api/v1/auth/line", json=body)
    _assert_error(response, 400, "INVALID_ARGUMENT", "auth.id_token_required")
    for mock in (guest, upsert, finish, validator):
        mock.assert_not_called()
    assert not user_model.mock_calls
    assert not fake_db.session.mock_calls


@pytest.mark.parametrize("dev_mode", [False, True])
@pytest.mark.parametrize("body", [{}, {"id_token": " "}, {"id_token": None}])
def test_missing_token_and_dev_id_rejected_before_guest(
    client, app, modules, fake_db, monkeypatch, dev_mode, body
):
    app.config["AUTH_DEV_MODE"] = dev_mode
    guest = Mock()
    monkeypatch.setattr(modules.routes, "_guest_context", guest)
    response = client.post("/api/v1/auth/line", json=body)
    _assert_error(response, 400, "INVALID_ARGUMENT", "auth.id_token_required")
    guest.assert_not_called()
    assert not fake_db.session.mock_calls


@pytest.mark.parametrize("is_new", [True, False])
def test_local_dev_login_preserves_profile_and_guest_context(
    client, app, modules, monkeypatch, is_new
):
    app.config["AUTH_DEV_MODE"] = True
    routes = modules.routes
    user = _user(modules, sub="dev:synthetic-dev")
    guest_session, guest_user = Mock(), _user(modules, "guest:synthetic", "guest", 102)
    user_model = Mock()
    user_model.query.filter_by.return_value.first.return_value = None if is_new else user
    profile = {"display_name": "Synthetic Dev", "email": "dev@example.com", "avatar_png": b"fake-png"}
    profile_generator = Mock(return_value=profile)
    upsert = Mock(return_value=user)
    finish = Mock(side_effect=lambda *args: modules.errors.ok({"user": user.to_dict()}))
    validator = Mock()
    monkeypatch.setattr(routes, "User", user_model)
    monkeypatch.setattr(routes, "_guest_context", Mock(return_value=(guest_session, guest_user)))
    monkeypatch.setattr(routes, "_dev_line_profile", profile_generator)
    monkeypatch.setattr(routes, "_upsert_line_user", upsert)
    monkeypatch.setattr(routes, "_finish_login", finish)
    monkeypatch.setattr(routes, "_verify_line_id_token", validator)
    response = client.post("/api/v1/auth/line", json={"dev_id": " synthetic-dev ", "language": "en"})
    assert response.status_code == 200
    assert response.get_json() == {"code": "OK", "data": {"user": user.to_dict()}}
    user_model.query.filter_by.assert_called_once_with(line_provider="line", line_sub="dev:synthetic-dev")
    upsert.assert_called_once_with("line", "dev:synthetic-dev", profile if is_new else None, "en")
    finish.assert_called_once_with(user, "en", guest_session, guest_user)
    assert profile_generator.call_count == int(is_new)
    validator.assert_not_called()


def test_local_dev_profile_remains_available(modules, monkeypatch):
    monkeypatch.setattr(modules.routes, "_dev_avatar_png", Mock(return_value=b"fake-png"))
    profile = modules.routes._dev_line_profile()
    assert set(profile) == {"display_name", "avatar_png", "email", "phone"}
    assert profile["phone"].startswith("+66 ")
    assert not profile["email"] or profile["email"].endswith("@example.com")
    assert profile["avatar_png"] == b"fake-png"


def test_local_dev_id_length_checked_before_guest(client, app, modules, monkeypatch):
    app.config["AUTH_DEV_MODE"] = True
    guest = Mock()
    monkeypatch.setattr(modules.routes, "_guest_context", guest)
    response = client.post("/api/v1/auth/line", json={"dev_id": "x" * 65})
    _assert_error(response, 400, "INVALID_ARGUMENT", "error.invalid_argument")
    guest.assert_not_called()


@pytest.mark.parametrize("dev_mode", [False, True])
@pytest.mark.parametrize("with_guest", [False, True])
def test_valid_line_verifies_before_guest_and_preserves_login_response(
    client, app, modules, fake_db, monkeypatch, dev_mode, with_guest
):
    app.config["AUTH_DEV_MODE"] = dev_mode
    routes = modules.routes
    user = _user(modules)
    guest_user = _user(modules, "guest:synthetic", "guest", 102) if with_guest else None
    guest_session = Mock() if with_guest else None
    events = []
    claims = {
        "sub": "U-synthetic-line",
        "name": "Synthetic LINE",
        "picture": "https://example.com/synthetic.png",
        "email": "line@example.com",
        "phone_number": "+66000000000",
    }

    def validate(token):
        events.append("verify")
        assert token == "synthetic-valid-token"
        return claims

    def guest_context():
        events.append("guest")
        return guest_session, guest_user

    upsert = Mock(side_effect=lambda *args: events.append("upsert") or user)
    claim = Mock(return_value="synthetic-avatar-path")
    delete = Mock()
    subscribe = Mock()
    tenant = _tenant(modules, 11, owner_user_id=user.id)
    ensure_tenant = Mock(return_value=tenant)
    monkeypatch.setattr(routes, "_verify_line_id_token", validate)
    monkeypatch.setattr(routes, "_guest_context", guest_context)
    monkeypatch.setattr(routes, "_upsert_line_user", upsert)
    monkeypatch.setattr(routes, "_claim_guest_data", claim)
    monkeypatch.setattr(routes, "ensure_personal_tenant", ensure_tenant)
    monkeypatch.setattr(routes.storage, "delete", delete)
    monkeypatch.setattr(routes.subscriptions, "ensure_subscription", subscribe)
    monkeypatch.setattr(
        routes, "list_tenants",
        Mock(return_value=[{"tenant_id": 11, "tenant_type": "PERSONAL", "name": None, "role": None}]),
    )
    response = client.post(
        "/api/v1/auth/line", json={"id_token": " synthetic-valid-token ", "language": "en"}
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["code"] == "OK"
    assert payload["data"]["user"] == user.to_dict()
    assert payload["data"]["csrf_token"]
    assert payload["data"]["tenants"] == [
        {"tenant_id": 11, "tenant_type": "PERSONAL", "name": None, "role": None}
    ]
    cookie = response.headers["Set-Cookie"]
    assert cookie.startswith("saiflow_session=")
    assert "HttpOnly" in cookie and "Path=/api" in cookie and "SameSite=Lax" in cookie
    assert events == ["verify", "guest", "upsert"]
    upsert.assert_called_once_with(
        "line", "U-synthetic-line",
        {"display_name": claims["name"], "avatar_url": claims["picture"],
         "email": claims["email"], "phone": claims["phone_number"]},
        "en",
    )
    ensure_tenant.assert_called_once_with(user)  # 老账号登录也会补个人租户
    if with_guest:
        claim.assert_called_once_with(guest_user, user, tenant)
        delete.assert_called_once_with("synthetic-avatar-path")
    else:
        claim.assert_not_called()
        delete.assert_not_called()
    subscribe.assert_called_once_with(tenant, commit=True)  # 默认开通 Kinder 一个月（幂等）
    fake_db.session.add.assert_called_once()


@pytest.mark.parametrize("dev_mode, include_dev_id", [(False, False), (True, False), (True, True)])
def test_invalid_line_token_never_falls_back_or_touches_guest(
    client, app, modules, fake_db, monkeypatch, dev_mode, include_dev_id
):
    app.config["AUTH_DEV_MODE"] = dev_mode
    routes = modules.routes
    validator = Mock(side_effect=modules.errors.ApiError(401, "AUTH_REQUIRED", "auth.line_token_invalid"))
    guest, upsert, profile, finish = Mock(), Mock(), Mock(), Mock()
    for name, mock in (
        ("_verify_line_id_token", validator), ("_guest_context", guest),
        ("_upsert_line_user", upsert), ("_dev_line_profile", profile), ("_finish_login", finish),
    ):
        monkeypatch.setattr(routes, name, mock)
    body = {"id_token": "synthetic-invalid-token"}
    if include_dev_id:
        body["dev_id"] = "synthetic-dev"
    response = client.post("/api/v1/auth/line", json=body)
    _assert_error(response, 401, "AUTH_REQUIRED", "auth.line_token_invalid")
    validator.assert_called_once_with("synthetic-invalid-token")
    for mock in (guest, upsert, profile, finish):
        mock.assert_not_called()
    assert not fake_db.session.mock_calls


@pytest.mark.parametrize(
    "sub, provider, dev_mode, accepted",
    [
        ("dev:synthetic", "line", False, False),
        ("dev:synthetic", "line", True, True),
        ("U-synthetic-line", "line", False, True),
        ("U-synthetic-line", "line", True, True),
        ("guest:synthetic", "guest", False, True),
        ("guest:synthetic", "guest", True, True),
    ],
)
def test_session_rejects_old_dev_before_touch_without_deleting_data(
    app, modules, fake_db, monkeypatch, sub, provider, dev_mode, accepted
):
    app.config["AUTH_DEV_MODE"] = dev_mode
    user = _user(modules, sub, provider)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    session = modules.models.Session(
        user_id=user.id,
        token_hash=modules.auth._hash("synthetic-cookie"),
        absolute_expires_at=now + timedelta(days=1),
        idle_expires_at=now + timedelta(hours=1),
        revoked_at=None,
    )
    original_expiry = session.idle_expires_at
    touch = Mock(wraps=session.touch)
    monkeypatch.setattr(session, "touch", touch)
    session_model = Mock()
    session_model.query.filter_by.return_value.first.return_value = session
    monkeypatch.setattr(modules.auth, "Session", session_model)
    fake_db.session.get.return_value = user
    with app.test_request_context(headers={"Cookie": "saiflow_session=synthetic-cookie"}):
        resolved, current_user, error = modules.auth.resolve_session()
        assert resolved is session
        if accepted:
            assert current_user is user and error is None
        else:
            assert current_user is None and error == "AUTH_REQUIRED"
            with pytest.raises(modules.errors.ApiError) as raised:
                modules.auth.raise_for_session_error(error)
            assert raised.value.http_status == 401
            assert raised.value.code == "AUTH_REQUIRED"
    session_model.query.filter_by.assert_called_once_with(token_hash=session.token_hash)
    fake_db.session.get.assert_called_once_with(modules.models.User, user.id)
    if accepted:
        touch.assert_called_once_with(app.config["SESSION_IDLE_TTL_SECONDS"])
        fake_db.session.commit.assert_called_once_with()
        assert session.idle_expires_at > original_expiry
    else:
        touch.assert_not_called()
        fake_db.session.commit.assert_not_called()
        assert session.idle_expires_at == original_expiry
    fake_db.session.delete.assert_not_called()
    fake_db.session.add.assert_not_called()
    assert user.line_sub == sub and session.revoked_at is None


@pytest.mark.parametrize("dev_mode", [False, True])
def test_guest_endpoint_still_reuses_guest_session(client, app, modules, monkeypatch, dev_mode):
    app.config["AUTH_DEV_MODE"] = dev_mode
    guest = _user(modules, "guest:synthetic", "guest")
    session = Mock()
    monkeypatch.setattr(modules.routes, "resolve_session", Mock(return_value=(session, guest, None)))
    rotate = Mock(return_value="synthetic-csrf")
    monkeypatch.setattr(modules.routes, "_rotate_csrf", rotate)
    monkeypatch.setattr(modules.routes, "list_tenants", Mock(return_value=[]))
    response = client.post("/api/v1/auth/guest", json={})
    assert response.status_code == 200
    assert response.get_json() == {
        "code": "OK", "data": {"user": guest.to_dict(), "csrf_token": "synthetic-csrf", "tenants": []}
    }
    rotate.assert_called_once_with(session)


@pytest.mark.parametrize("dev_mode", [False, True])
def test_guest_endpoint_still_creates_guest(client, app, modules, fake_db, monkeypatch, dev_mode):
    app.config["AUTH_DEV_MODE"] = dev_mode
    routes = modules.routes
    monkeypatch.setattr(routes, "resolve_session", Mock(return_value=(None, None, "AUTH_REQUIRED")))
    issue = Mock(side_effect=lambda user, language: modules.errors.ok({"user": user.to_dict()}))
    subscribe = Mock()
    tenant = _tenant(modules, 12, owner_user_id=102, name="Guest")
    ensure_tenant = Mock(return_value=tenant)
    monkeypatch.setattr(routes, "_issue_session_response", issue)
    monkeypatch.setattr(routes, "ensure_personal_tenant", ensure_tenant)
    monkeypatch.setattr(routes.subscriptions, "ensure_subscription", subscribe)
    response = client.post("/api/v1/auth/guest", json={"language": "en"})
    assert response.status_code == 200
    assert response.get_json()["data"]["user"]["is_guest"] is True
    guest = fake_db.session.add.call_args.args[0]
    assert guest.line_provider == "guest" and guest.line_sub.startswith("guest:")
    assert guest.language == "en"
    issue.assert_called_once_with(guest, "en")
    fake_db.session.flush.assert_called_once_with()
    # 游客也必须有个人租户，否则试用期的文件/任务没有 tenant_id 可挂
    ensure_tenant.assert_called_once_with(guest)
    subscribe.assert_called_once_with(tenant, commit=True)  # 游客试用同样是 Kinder 一个月


@pytest.mark.parametrize("dev_mode", [False, True])
def test_email_code_bypass_is_only_enabled_in_dev(app, modules, monkeypatch, dev_mode):
    app.config["AUTH_DEV_MODE"] = dev_mode
    record_model = Mock()
    record_model.query.filter_by.return_value.order_by.return_value.first.return_value = None
    monkeypatch.setattr(modules.me, "EmailVerificationCode", record_model)
    with app.app_context():
        if dev_mode:
            modules.me._consume_email_code(_user(modules), "synthetic@example.com", "000000")
            assert not record_model.mock_calls
        else:
            with pytest.raises(modules.errors.ApiError) as raised:
                modules.me._consume_email_code(_user(modules), "synthetic@example.com", "000000")
            assert raised.value.http_status == 400
            assert raised.value.field_errors == [{"field": "code", "message_key": "error.email_code_invalid"}]
            record_model.query.filter_by.assert_called_once_with(
                user_id=101, email="synthetic@example.com", consumed_at=None
            )


def test_production_email_sender_remains_unavailable(client, modules, fake_db, monkeypatch):
    monkeypatch.setattr(modules.me, "_require_member", Mock(return_value=_user(modules)))
    response = client.post("/api/v1/me/email/code", json={"email": "other@example.com"})
    _assert_error(response, 503, "EMAIL_SERVICE_UNAVAILABLE", "email.sender_unavailable")
    assert not fake_db.session.mock_calls


# FR-SYS-014/016, AC-FR-SYS-014-01..05 and AC-FR-SYS-016-01/02.
# Real mapped objects + an in-memory query/session double, never db.init_app.
FIXED_NOW = datetime(2026, 10, 27, 12, 0, 0)
SYNTHETIC_CODE = "012345"


def _assert_field_error(response, field, key):
    assert response.status_code == 400
    payload = response.get_json()
    assert payload == {
        "code": "INVALID_ARGUMENT",
        "message_key": "error.invalid_argument",
        "request_id": payload["request_id"],
        "retryable": False,
        "field_errors": [{"field": field, "message_key": key}],
    }
    assert isinstance(payload["request_id"], str) and payload["request_id"]


@pytest.fixture
def member(modules, monkeypatch):
    user = _user(modules)
    user.phone = "+66 81 234 5678"
    monkeypatch.setattr(modules.me, "current_user", Mock(return_value=user))
    monkeypatch.setattr(modules.me, "_now", Mock(return_value=FIXED_NOW))
    monkeypatch.setattr(modules.me, "audit", Mock())
    monkeypatch.setattr(modules.me.storage, "delete", Mock())
    return user


@pytest.fixture
def email_store(modules, fake_db, monkeypatch):
    """Evaluate filter_by/order/update against real objects without SQL execution.

    Keep pending inserts distinct from committed rows. Calls remain inspectable;
    this models sequential requests, not PostgreSQL concurrency or isolation.
    """
    rows, pending, events, snapshots = [], [], [], {}
    model = modules.models.EmailVerificationCode
    root = Mock(name="email_code_query")

    def matching(filters):
        return [row for row in rows if all(getattr(row, key) == value for key, value in filters.items())]

    def filtered(**filters):
        query = Mock(name="filtered_email_codes")
        query.order_by.return_value = query
        query.first.side_effect = lambda: next(
            iter(sorted(matching(filters), key=lambda row: row.created_at, reverse=True)), None
        )

        def update(values, synchronize_session):
            assert synchronize_session is False
            events.append("invalidate")
            selected = matching(filters)
            for row in selected:
                snapshots.setdefault(id(row), (row, row.consumed_at))
                for key, value in values.items():
                    setattr(row, key, value)
            return len(selected)

        query.update.side_effect = update
        return query

    root.filter_by.side_effect = filtered
    proxy = Mock(wraps=model)
    proxy.query = root
    proxy.created_at = model.created_at
    monkeypatch.setattr(modules.me, "EmailVerificationCode", proxy)

    def add(row):
        assert isinstance(row, model)
        events.append("add")
        pending.append(row)

    def commit():
        events.append("commit")
        rows.extend(pending)
        pending.clear()
        snapshots.clear()

    def rollback():
        events.append("rollback")
        pending.clear()
        for row, consumed_at in snapshots.values():
            row.consumed_at = consumed_at
        snapshots.clear()

    fake_db.session.add.side_effect = add
    fake_db.session.commit.side_effect = commit
    fake_db.session.rollback.side_effect = rollback
    fake_db.session.execute.side_effect = lambda statement: events.append("lock")
    fake_db.session.refresh.side_effect = lambda user: events.append("refresh")

    def seed(code=SYNTHETIC_CODE, email="synthetic@example.com", user_id=101, **overrides):
        values = dict(
            user_id=user_id, email=email,
            code_hash=hashlib.sha256(code.encode()).hexdigest(),
            created_at=FIXED_NOW - timedelta(seconds=61),
            expires_at=FIXED_NOW + timedelta(minutes=9), consumed_at=None,
        )
        values.update(overrides)
        row = model(**values)
        rows.append(row)
        return row

    return SimpleNamespace(rows=rows, pending=pending, events=events, query=root, seed=seed)


@pytest.fixture
def mail_config(app):
    # Never load Config/.env or shell mail settings: these values are entirely synthetic.
    app.config.update(
        MAIL_SMTP_HOST="smtp.example.com",
        MAIL_SMTP_PORT=465,
        MAIL_SMTP_SECURITY="ssl",
        MAIL_SMTP_USERNAME="sender@example.com",
        MAIL_SMTP_PASSWORD="synthetic-password",
        MAIL_FROM="sender@example.com",
        MAIL_SMTP_TIMEOUT_SECONDS=7,
    )
    return app.config


@pytest.fixture
def smtp_double(monkeypatch, modules):
    smtp = MagicMock(name="local_smtp")
    smtp.__enter__.return_value = smtp
    smtp.__exit__.return_value = False
    smtp.send_message.return_value = {}
    ssl_client = Mock(name="local_smtp_ssl", return_value=smtp)
    tls_client = Mock(name="local_smtp_starttls", return_value=smtp)
    monkeypatch.setattr(modules.email_sender.smtplib, "SMTP_SSL", ssl_client)
    monkeypatch.setattr(modules.email_sender.smtplib, "SMTP", tls_client)
    return SimpleNamespace(smtp=smtp, ssl=ssl_client, starttls=tls_client)


def _registration_body(**changes):
    body = {"display_name": " Edited User ", "email": "synthetic@example.com", "code": SYNTHETIC_CODE}
    body.update(changes)
    return body


def _assert_user_locked(fake_db, modules, user):
    fake_db.session.execute.assert_called_once()
    statement = fake_db.session.execute.call_args.args[0]
    assert statement._for_update_arg is not None
    assert list(statement.selected_columns) == [modules.models.User.id.property.columns[0]]
    assert statement.compile().params == {"id_1": user.id}
    fake_db.session.refresh.assert_called_once_with(user)


@pytest.mark.parametrize(
    "phone, expected",
    [
        (None, ""), ("", ""), ("   ", ""), ("123456", "123456"),
        ("123456789012345", "123456789012345"),
        ("  +66 (81) 234-5678  ", "+66 (81) 234-5678"),
        ("081.234.5678", "081.234.5678"),
        ("1" + " " * 26 + "23456", "1" + " " * 26 + "23456"),
    ],
)
def test_registration_optional_phone_formats_and_boundaries_are_saved(
    client, modules, fake_db, member, email_store, phone, expected
):
    record = email_store.seed()
    response = client.post("/api/v1/me/registration", json=_registration_body(phone=phone))
    assert response.status_code == 200
    assert response.get_json() == {"code": "OK", "data": member.to_dict()}
    assert member.phone == expected
    assert member.display_name == "Edited User"
    assert member.email == "synthetic@example.com"
    assert member.registered_at == FIXED_NOW and record.consumed_at == FIXED_NOW
    _assert_user_locked(fake_db, modules, member)
    fake_db.session.commit.assert_called_once_with()
    modules.me.audit.assert_called_once_with("user.register", "user", str(member.id))


@pytest.mark.parametrize("original", ["", "+66 81 234 5678"])
def test_registration_omitted_phone_preserves_line_value(
    client, fake_db, member, email_store, original
):
    member.phone = original
    email_store.seed()
    response = client.post("/api/v1/me/registration", json=_registration_body())
    assert response.status_code == 200
    assert member.phone == original
    assert response.get_json()["data"]["phone"] == original
    fake_db.session.commit.assert_called_once_with()


@pytest.mark.parametrize(
    "phone",
    ["12345", "1234567890123456", "1" + " " * 27 + "23456", "abc123456",
     "+66/812345678", "++66812345678", "081234\n5678", "０８１２３４５６７８", "123456<script>"],
)
def test_registration_invalid_phone_does_not_commit_or_consume(
    client, modules, fake_db, member, email_store, phone
):
    record = email_store.seed()
    before = member.to_dict()
    response = client.post("/api/v1/me/registration", json=_registration_body(phone=phone))
    _assert_field_error(response, "phone", "error.phone_invalid")
    assert member.to_dict() == before and record.consumed_at is None
    fake_db.session.commit.assert_not_called()
    fake_db.session.add.assert_not_called()
    modules.me.audit.assert_not_called()


@pytest.mark.parametrize(
    "changes, field, key",
    [
        ({"display_name": " "}, "display_name", "error.field_required"),
        ({"display_name": "x" * 129}, "display_name", "error.field_required"),
        ({"email": None}, "email", "error.field_required"),
        ({"email": " "}, "email", "error.field_required"),
        ({"email": "bad-address"}, "email", "error.email_invalid"),
        ({"email": "x" * 243 + "@example.com"}, "email", "error.email_invalid"),
        ({"code": None}, "code", "error.field_required"),
        ({"code": " "}, "code", "error.field_required"),
    ],
)
def test_registration_field_errors_never_complete_or_commit(
    client, modules, fake_db, member, email_store, changes, field, key
):
    record = email_store.seed()
    before = member.to_dict()
    response = client.post("/api/v1/me/registration", json=_registration_body(**changes))
    _assert_field_error(response, field, key)
    assert member.to_dict() == before and record.consumed_at is None
    fake_db.session.commit.assert_not_called()
    fake_db.session.add.assert_not_called()
    modules.me.audit.assert_not_called()


@pytest.mark.parametrize("status", ["guest", "already_registered"])
def test_registration_guest_and_duplicate_are_rejected(
    client, modules, fake_db, member, email_store, status
):
    if status == "guest":
        member.line_provider = "guest"
    else:
        member.registered_at = FIXED_NOW - timedelta(days=1)
    before = member.to_dict()
    response = client.post("/api/v1/me/registration", json=_registration_body())
    if status == "guest":
        _assert_error(response, 403, "PERMISSION_DENIED", "error.permission_denied")
        fake_db.session.execute.assert_not_called()
    else:
        _assert_error(response, 409, "STATE_CONFLICT", "registration.already_done")
        _assert_user_locked(fake_db, modules, member)
    assert member.to_dict() == before
    fake_db.session.commit.assert_not_called()
    email_store.query.filter_by.assert_not_called()


@pytest.mark.parametrize("avatar_failure", [ValueError("synthetic-invalid-avatar"), OSError("synthetic-storage-failure")])
def test_registration_avatar_error_never_commits(
    client, modules, fake_db, member, email_store, monkeypatch, avatar_failure
):
    email_store.seed()
    before = member.to_dict()
    monkeypatch.setattr(modules.me.avatars, "apply", Mock(side_effect=avatar_failure))
    response = client.post(
        "/api/v1/me/registration", json=_registration_body(avatar_url="https://example.com/avatar.png")
    )
    if isinstance(avatar_failure, ValueError):
        _assert_field_error(response, "avatar_url", "error.avatar_invalid")
    else:
        _assert_error(response, 503, "STORAGE_UNAVAILABLE", "avatar.upload_failed")
    assert member.to_dict() == before
    fake_db.session.commit.assert_not_called()
    modules.me.storage.delete.assert_not_called()
    modules.me.audit.assert_not_called()


@pytest.mark.parametrize("state", ["new", "unregistered", "registered"])
@pytest.mark.parametrize("has_email, has_phone", [(False, False), (True, False), (False, True), (True, True)])
def test_verified_line_claims_supply_defaults_and_never_overwrite_registered_profile(
    client, app, modules, fake_db, monkeypatch, state, has_email, has_phone
):
    routes = modules.routes
    user = _user(modules)
    user.display_name, user.avatar_url = "Saved Name", "https://example.com/saved.png"
    user.phone, user.email = "+66 81 234 5678", "saved@example.com"
    if state == "registered":
        user.registered_at = FIXED_NOW
    else:
        user.phone = user.email = ""
    saved = user.to_dict()

    def new_user(**values):
        # SQLAlchemy column defaults are materialized by real INSERT/flush; emulate
        # those defaults explicitly here, rather than hiding missing values in to_dict.
        fresh = _user(modules)
        fresh.display_name = fresh.avatar_url = fresh.phone = fresh.email = ""
        for name, value in values.items():
            setattr(fresh, name, value)
        return fresh

    user_model = Mock(side_effect=new_user)
    user_model.query.filter_by.return_value.first.return_value = None if state == "new" else user
    monkeypatch.setattr(routes, "User", user_model)
    # 租户补建另有专门用例覆盖，这里只关心 LINE 资料不覆盖已注册信息
    monkeypatch.setattr(routes, "ensure_personal_tenant", Mock())
    claims = {
        "iss": routes.LINE_ISSUER, "aud": app.config["LINE_CHANNEL_ID"],
        "exp": int(datetime.now(timezone.utc).timestamp()) + 3600,
        "sub": "U-synthetic-line", "name": "LINE Name", "picture": "https://example.com/line.png",
    }
    if has_email:
        claims["email"] = "line@example.com"
    if has_phone:
        claims["phone_number"] = "+66800000000"
    verify = Mock(return_value=httpx.Response(200, json=claims))
    monkeypatch.setattr(routes.httpx, "post", verify)
    monkeypatch.setattr(routes, "_guest_context", Mock(return_value=(None, None)))
    finish = Mock(side_effect=lambda current, *args: modules.errors.ok({"user": current.to_dict()}))
    monkeypatch.setattr(routes, "_finish_login", finish)
    response = client.post(
        "/api/v1/auth/line",
        json={"id_token": "synthetic-token", "email": "untrusted@example.com", "phone": "+66999999999"},
    )
    assert response.status_code == 200
    payload = response.get_json()["data"]["user"]
    if state == "registered":
        assert payload == saved
    else:
        assert payload["email"] == ("line@example.com" if has_email else "")
        assert payload["phone"] == ("+66800000000" if has_phone else "")
        assert payload["display_name"] == "LINE Name"
        assert payload["avatar_url"] == claims["picture"]
        assert payload["registered"] is False
    user_model.query.filter_by.assert_called_once_with(line_provider="line", line_sub=claims["sub"])
    verify.assert_called_once()
    assert verify.call_args.args == (routes.LINE_VERIFY_URL,)
    assert verify.call_args.kwargs["data"] == {
        "id_token": "synthetic-token", "client_id": "synthetic-channel",
    }
    fake_db.session.flush.assert_called_once_with()
    assert fake_db.session.add.call_count == int(state == "new")
    if state == "new":
        fake_db.session.refresh.assert_not_called()
    else:
        fake_db.session.refresh.assert_called_once_with(user, with_for_update=True)


@pytest.mark.parametrize("profile", [None, {"display_name": "LINE Name", "email": "line@example.com", "phone": "+66800000000", "avatar_url": "https://example.com/line.png"}])
def test_line_login_reloads_registration_state_under_lock(app, modules, fake_db, monkeypatch, profile):
    user = _user(modules)
    user_model = Mock()
    user_model.query.filter_by.return_value.first.return_value = user
    monkeypatch.setattr(modules.routes, "User", user_model)
    monkeypatch.setattr(modules.routes, "ensure_personal_tenant", Mock())

    def registration_committed(locked_user, *, with_for_update):
        assert locked_user is user and with_for_update is True
        user.registered_at = FIXED_NOW
        user.display_name = "Registered Name"
        user.email = "registered@example.com"
        user.phone = "+66812345678"
        user.avatar_url = "https://example.com/registered.png"

    fake_db.session.refresh.side_effect = registration_committed
    with app.app_context():
        result = modules.routes._upsert_line_user("line", user.line_sub, profile, "en")
    assert result is user
    assert user.registered_at == FIXED_NOW
    assert user.display_name == "Registered Name"
    assert user.email == "registered@example.com"
    assert user.phone == "+66812345678"
    assert user.avatar_url == "https://example.com/registered.png"
    fake_db.session.refresh.assert_called_once_with(user, with_for_update=True)
    fake_db.session.flush.assert_called_once_with()


@pytest.mark.parametrize("method", ["smtp_ssl", "smtp", "socket", "database", "http"])
def test_external_io_guard_blocks_default_clients(method):
    with pytest.raises(AssertionError, match="forbid"):
        if method == "smtp_ssl":
            smtplib.SMTP_SSL("smtp.example.com", 465)
        elif method == "smtp":
            smtplib.SMTP("smtp.example.com", 587)
        elif method == "socket":
            socket.create_connection(("smtp.example.com", 465))
        elif method == "database":
            Engine.connect(None)
        else:
            httpx.post("https://example.com/synthetic")


@pytest.mark.parametrize(
    "environment, expected",
    [
        ({}, ("", 465, "ssl", "", "", "", 10.0)),
        ({"MAIL_SMTP_HOST": "smtp.example.com", "MAIL_SMTP_PORT": "587", "MAIL_SMTP_SECURITY": "starttls",
          "MAIL_SMTP_USERNAME": "sender@example.com", "MAIL_SMTP_PASSWORD": "synthetic-password",
          "MAIL_SMTP_TIMEOUT_SECONDS": "7.5"},
         ("smtp.example.com", 587, "starttls", "sender@example.com", "synthetic-password", "sender@example.com", 7.5)),
    ],
)
def test_mail_config_defaults_and_synthetic_environment_mapping(environment, expected):
    with patch.dict(os.environ, environment, clear=True), patch("dotenv.load_dotenv"):
        config = _load_module("registration_mail_config", "config.py").Config
    assert tuple(getattr(config, name) for name in (
        "MAIL_SMTP_HOST", "MAIL_SMTP_PORT", "MAIL_SMTP_SECURITY", "MAIL_SMTP_USERNAME",
        "MAIL_SMTP_PASSWORD", "MAIL_FROM", "MAIL_SMTP_TIMEOUT_SECONDS",
    )) == expected


@pytest.mark.parametrize("missing", ["MAIL_SMTP_HOST", "MAIL_SMTP_USERNAME", "MAIL_SMTP_PASSWORD", "MAIL_FROM"])
def test_missing_mail_configuration_returns_safe_503_before_lock_or_smtp(
    client, app, modules, fake_db, member, email_store, mail_config, smtp_double, missing
):
    app.config[missing] = ""
    with app.app_context(), pytest.raises(modules.email_sender.EmailDeliveryError, match="^not_configured$"):
        modules.email_sender.ensure_configured()
    response = client.post("/api/v1/me/email/code", json={"email": member.email})
    _assert_error(response, 503, "EMAIL_SERVICE_UNAVAILABLE", "email.sender_unavailable")
    assert not fake_db.session.mock_calls
    smtp_double.ssl.assert_not_called()
    smtp_double.starttls.assert_not_called()
    assert email_store.rows == [] and email_store.pending == []
    assert member.registered_at is None


@pytest.mark.parametrize("security", ["", "none", "plain", "SSL", "tls"])
def test_plaintext_or_unknown_mail_security_is_never_allowed(
    client, app, modules, fake_db, member, email_store, mail_config, smtp_double, security
):
    app.config["MAIL_SMTP_SECURITY"] = security
    with app.app_context(), pytest.raises(modules.email_sender.EmailDeliveryError, match="^tls_required$"):
        modules.email_sender.ensure_configured()
    response = client.post("/api/v1/me/email/code", json={"email": member.email})
    _assert_error(response, 503, "EMAIL_SERVICE_UNAVAILABLE", "email.sender_unavailable")
    assert not fake_db.session.mock_calls
    smtp_double.ssl.assert_not_called()
    smtp_double.starttls.assert_not_called()
    assert email_store.rows == [] and member.registered_at is None


@pytest.mark.parametrize("security, port", [("ssl", 465), ("starttls", 587)])
def test_smtp_protocol_uses_verified_tls_before_authentication_and_sending(
    app, modules, mail_config, smtp_double, security, port
):
    app.config.update(MAIL_SMTP_SECURITY=security, MAIL_SMTP_PORT=port)
    with app.app_context():
        modules.email_sender.send_verification_code("recipient@example.com", SYNTHETIC_CODE)
    chosen = smtp_double.ssl if security == "ssl" else smtp_double.starttls
    unused = smtp_double.starttls if security == "ssl" else smtp_double.ssl
    chosen.assert_called_once()
    unused.assert_not_called()
    assert chosen.call_args.args == ("smtp.example.com", port)
    assert chosen.call_args.kwargs["timeout"] == 7
    smtp = smtp_double.smtp
    if security == "ssl":
        context = chosen.call_args.kwargs["context"]
        assert smtp.starttls.call_count == 0
        expected = ["__enter__", "ehlo", "login", "send_message", "__exit__"]
    else:
        assert "context" not in chosen.call_args.kwargs
        smtp.starttls.assert_called_once()
        context = smtp.starttls.call_args.kwargs["context"]
        expected = ["__enter__", "ehlo", "starttls", "ehlo", "login", "send_message", "__exit__"]
    assert isinstance(context, ssl.SSLContext)
    assert context.check_hostname is True and context.verify_mode == ssl.CERT_REQUIRED
    assert [entry[0] for entry in smtp.mock_calls] == expected
    smtp.login.assert_called_once_with("sender@example.com", "synthetic-password")
    message = smtp.send_message.call_args.args[0]
    assert message["To"].addresses[0].addr_spec == "recipient@example.com"
    assert SYNTHETIC_CODE in message.get_body(preferencelist=("plain",)).get_content()
    assert smtp.send_message.call_args.kwargs == {
        "from_addr": "sender@example.com", "to_addrs": ["recipient@example.com"],
    }
    smtp.__exit__.assert_called_once_with(None, None, None)


@pytest.mark.parametrize(
    "language, subject, expiry, warning, ignore",
    [
        ("en", "Your SaiFlow email verification code", "This code expires in 7 minutes and can only be used once.",
         "Do not share this code. SaiFlow support will never ask for it.",
         "If you did not request this code, you can safely ignore this email."),
        ("th", "รหัสยืนยันอีเมล SaiFlow", "รหัสนี้ใช้ได้ 7 นาที และใช้ได้เพียงครั้งเดียว",
         "อย่าแชร์รหัสนี้กับผู้อื่น ทีมงาน SaiFlow จะไม่ขอรหัสของคุณ",
         "หากคุณไม่ได้ขอรหัสนี้ โปรดไม่ต้องดำเนินการใด ๆ"),
    ],
)
def test_verification_email_is_bilingual_multipart_with_code_ttl_and_safety(
    modules, language, subject, expiry, warning, ignore
):
    message = modules.email_sender.verification_message(
        "sender@example.com", "recipient@example.com", SYNTHETIC_CODE, language=language, ttl_minutes=7,
    )
    # Check the serialized wire message too, including Thai Unicode round-trip.
    parsed = BytesParser(policy=policy.default).parsebytes(message.as_bytes())
    assert parsed.get_content_type() == "multipart/alternative"
    assert [part.get_content_type() for part in parsed.iter_parts()] == ["text/plain", "text/html"]
    assert str(parsed["Subject"]) == subject
    assert parsed["From"].addresses[0].addr_spec == "sender@example.com"
    assert parsed["To"].addresses[0].addr_spec == "recipient@example.com"
    assert parsed["Date"] and parsed["Message-ID"]
    for preference in ("plain", "html"):
        body = parsed.get_body(preferencelist=(preference,)).get_content()
        for text in ("SaiFlow", SYNTHETIC_CODE, expiry, warning, ignore):
            assert text in body
        assert "synthetic-password" not in body
    assert SYNTHETIC_CODE not in str(parsed["Subject"])


@pytest.mark.parametrize("code", ["", "12345", "1234567", "12a456", "１２３４５６", "123456\r\nBcc: injected@example.com"])
def test_verification_message_rejects_non_six_digit_code(modules, code):
    with pytest.raises(ValueError, match="six digits"):
        modules.email_sender.verification_message("sender@example.com", "recipient@example.com", code)


@pytest.mark.parametrize("address", ["sender", "recipient"])
def test_verification_message_rejects_address_header_injection(modules, address):
    sender = "sender@example.com"
    recipient = "recipient@example.com"
    injected = "recipient@example.com\r\nBcc: injected@example.com"
    if address == "sender":
        sender = injected
    else:
        recipient = injected
    with pytest.raises(ValueError):
        modules.email_sender.verification_message(sender, recipient, SYNTHETIC_CODE)


SMTP_FAILURES = [
    ("ssl", "connect"), ("ssl", "ehlo"), ("ssl", "login"),
    ("ssl", "refused_exception"), ("ssl", "refused_map"), ("ssl", "timeout"),
    ("ssl", "certificate"), ("ssl", "disconnect"),
    ("starttls", "connect"), ("starttls", "ehlo"), ("starttls", "starttls"),
    ("starttls", "login"), ("starttls", "refused_exception"), ("starttls", "refused_map"),
    ("starttls", "timeout"), ("starttls", "certificate"), ("starttls", "disconnect"),
]


def _smtp_failure(smtp_double, security, failure):
    diagnostic = f"synthetic-password {SYNTHETIC_CODE} recipient@example.com synthetic-vendor-detail"
    smtp = smtp_double.smtp
    constructor = smtp_double.ssl if security == "ssl" else smtp_double.starttls
    if failure == "connect":
        constructor.side_effect = OSError(diagnostic)
    elif failure == "ehlo":
        smtp.ehlo.side_effect = smtplib.SMTPHeloError(550, diagnostic.encode())
    elif failure == "starttls":
        smtp.starttls.side_effect = smtplib.SMTPNotSupportedError(diagnostic)
    elif failure == "login":
        smtp.login.side_effect = smtplib.SMTPAuthenticationError(535, diagnostic.encode())
    elif failure == "refused_exception":
        smtp.send_message.side_effect = smtplib.SMTPRecipientsRefused({"recipient@example.com": (550, diagnostic)})
    elif failure == "refused_map":
        smtp.send_message.return_value = {"recipient@example.com": (550, diagnostic)}
    elif failure == "timeout":
        smtp.send_message.side_effect = TimeoutError(diagnostic)
    elif failure == "certificate":
        target = constructor if security == "ssl" else smtp.starttls
        target.side_effect = ssl.SSLCertVerificationError(diagnostic)
    elif failure == "disconnect":
        smtp.send_message.side_effect = smtplib.SMTPServerDisconnected(diagnostic)
    else:
        raise AssertionError(f"Unknown local SMTP failure: {failure}")


@pytest.mark.parametrize("security, failure", SMTP_FAILURES)
def test_smtp_failures_are_sanitized_without_credentials_or_vendor_diagnostics(
    app, modules, mail_config, smtp_double, caplog, security, failure
):
    app.config["MAIL_SMTP_SECURITY"] = security
    _smtp_failure(smtp_double, security, failure)
    with app.app_context(), pytest.raises(modules.email_sender.EmailDeliveryError) as raised:
        modules.email_sender.send_verification_code("recipient@example.com", SYNTHETIC_CODE)
    assert str(raised.value) in ("delivery_failed", "recipient_rejected")
    for secret in ("synthetic-password", SYNTHETIC_CODE, "recipient@example.com", "synthetic-vendor-detail"):
        assert secret not in str(raised.value) and secret not in caplog.text
    assert not caplog.records
    if failure in ("connect", "ehlo", "starttls", "certificate"):
        smtp_double.smtp.login.assert_not_called()
    if failure in ("connect", "ehlo", "starttls", "certificate", "login"):
        smtp_double.smtp.send_message.assert_not_called()
    if failure != "connect" and not (failure == "certificate" and security == "ssl"):
        smtp_double.smtp.__exit__.assert_called_once()


@pytest.mark.parametrize("security, failure", SMTP_FAILURES)
def test_failed_smtp_send_rolls_back_without_new_code_commit_or_secret_leak(
    client, app, modules, fake_db, member, email_store, mail_config, smtp_double,
    monkeypatch, caplog, security, failure
):
    app.config["MAIL_SMTP_SECURITY"] = security
    old = email_store.seed(code="111111")
    monkeypatch.setattr(modules.me.secrets, "randbelow", Mock(return_value=int(SYNTHETIC_CODE)))
    _smtp_failure(smtp_double, security, failure)
    response = client.post("/api/v1/me/email/code", json={"email": "recipient@example.com"})
    _assert_error(response, 503, "EMAIL_SERVICE_UNAVAILABLE", "email.sender_unavailable")
    fake_db.session.rollback.assert_called_once_with()
    fake_db.session.commit.assert_not_called()
    fake_db.session.add.assert_not_called()
    _assert_user_locked(fake_db, modules, member)
    assert email_store.events == ["lock", "refresh", "rollback"]
    assert email_store.rows == [old] and email_store.pending == [] and old.consumed_at is None
    assert member.registered_at is None
    modules.me.audit.assert_not_called()
    for secret in ("synthetic-password", SYNTHETIC_CODE, "recipient@example.com", "synthetic-vendor-detail"):
        assert secret not in response.get_data(as_text=True) and secret not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)
    # A failed attempt must not become a usable registration code, even though an
    # older successfully sent code for another address still remains available.
    response = client.post(
        "/api/v1/me/registration", json=_registration_body(email="recipient@example.com")
    )
    _assert_field_error(response, "code", "error.email_code_invalid")
    fake_db.session.commit.assert_not_called()
    assert member.registered_at is None and old.consumed_at is None


@pytest.mark.parametrize("security, language", [("ssl", "en"), ("starttls", "th")])
def test_successful_send_persists_only_hash_after_delivery_and_invalidates_all_old_codes(
    client, app, modules, fake_db, member, email_store, mail_config, smtp_double,
    monkeypatch, caplog, security, language
):
    app.config.update(MAIL_SMTP_SECURITY=security, MAIL_SMTP_PORT=465 if security == "ssl" else 587)
    member.language = language
    old = email_store.seed()
    other_email = email_store.seed(email="old@example.com")
    other_user = email_store.seed(user_id=102)
    already_used = email_store.seed(consumed_at=FIXED_NOW - timedelta(minutes=1))
    original_used_at = already_used.consumed_at
    monkeypatch.setattr(modules.me.secrets, "randbelow", Mock(return_value=int(SYNTHETIC_CODE)))

    def accepted(message, **kwargs):
        assert email_store.events == ["lock", "refresh"]
        assert email_store.pending == [] and old.consumed_at is None and other_email.consumed_at is None
        fake_db.session.commit.assert_not_called()
        email_store.events.append("smtp_accepted")
        return {}

    smtp_double.smtp.send_message.side_effect = accepted
    response = client.post("/api/v1/me/email/code", json={"email": "  recipient@example.com  "})
    assert response.status_code == 200
    assert response.get_json() == {"code": "OK", "data": {"sent": True, "cooldown_seconds": 60}}
    assert email_store.events == ["lock", "refresh", "smtp_accepted", "invalidate", "add", "commit"]
    fake_db.session.commit.assert_called_once_with()
    _assert_user_locked(fake_db, modules, member)
    assert old.consumed_at == other_email.consumed_at == FIXED_NOW
    assert other_user.consumed_at is None and already_used.consumed_at == original_used_at
    new = email_store.rows[-1]
    assert new is fake_db.session.add.call_args.args[0]
    assert new.user_id == member.id and new.email == "recipient@example.com"
    assert new.code_hash == hashlib.sha256(SYNTHETIC_CODE.encode()).hexdigest()
    assert new.created_at == FIXED_NOW and new.expires_at == FIXED_NOW + timedelta(minutes=10)
    assert new.consumed_at is None and member.registered_at is None
    assert SYNTHETIC_CODE not in repr(vars(new))
    assert "synthetic-password" not in repr(vars(new))
    assert SYNTHETIC_CODE not in response.get_data(as_text=True) and SYNTHETIC_CODE not in caplog.text
    message = smtp_double.smtp.send_message.call_args.args[0]
    text = message.get_body(preferencelist=("plain",)).get_content()
    assert SYNTHETIC_CODE in text
    assert ("10 minutes" if language == "en" else "10 นาที") in text
    assert str(message["Subject"]) == ("Your SaiFlow email verification code" if language == "en" else "รหัสยืนยันอีเมล SaiFlow")
    modules.me.audit.assert_called_once_with("me.email_code", "user", str(member.id))


@pytest.mark.parametrize("age_seconds, allowed", [(0, False), (59, False), (59.999, False), (60, True), (61, True)])
def test_email_code_cooldown_boundary_blocks_network_and_new_records(
    client, modules, fake_db, member, email_store, mail_config, smtp_double, age_seconds, allowed
):
    old = email_store.seed(created_at=FIXED_NOW - timedelta(seconds=age_seconds))
    response = client.post("/api/v1/me/email/code", json={"email": "recipient@example.com"})
    if allowed:
        assert response.status_code == 200
        smtp_double.smtp.send_message.assert_called_once()
        fake_db.session.commit.assert_called_once_with()
        assert len(email_store.rows) == 2 and old.consumed_at == FIXED_NOW
    else:
        _assert_error(response, 429, "RATE_LIMITED", "error.rate_limited")
        smtp_double.ssl.assert_not_called()
        smtp_double.starttls.assert_not_called()
        fake_db.session.add.assert_not_called()
        fake_db.session.commit.assert_not_called()
        assert email_store.rows == [old] and old.consumed_at is None
        modules.me.audit.assert_not_called()


@pytest.mark.parametrize("dev_mode", [False, True])
def test_email_code_cooldown_is_per_user_across_recipient_addresses(
    client, app, fake_db, member, email_store, mail_config, smtp_double, dev_mode
):
    app.config["AUTH_DEV_MODE"] = dev_mode
    email_store.seed(email="other@example.com", consumed_at=FIXED_NOW, created_at=FIXED_NOW - timedelta(seconds=30))
    response = client.post("/api/v1/me/email/code", json={"email": "recipient@example.com"})
    _assert_error(response, 429, "RATE_LIMITED", "error.rate_limited")
    smtp_double.ssl.assert_not_called()
    smtp_double.starttls.assert_not_called()
    fake_db.session.commit.assert_not_called()


@pytest.mark.parametrize("registered", [False, True])
def test_dev_email_send_is_simulated_without_smtp_and_does_not_log_code(
    client, app, modules, fake_db, member, email_store, smtp_double, monkeypatch, caplog, registered
):
    app.config["AUTH_DEV_MODE"] = True
    if registered:
        member.registered_at = FIXED_NOW - timedelta(days=1)
    ensure = Mock(side_effect=AssertionError("dev must not require mail settings"))
    monkeypatch.setattr(modules.email_sender, "ensure_configured", ensure)
    monkeypatch.setattr(modules.me.secrets, "randbelow", Mock(return_value=int(SYNTHETIC_CODE)))
    caplog.set_level("INFO")
    response = client.post("/api/v1/me/email/code", json={"email": "recipient@example.com"})
    assert response.status_code == 200
    assert response.get_json()["data"] == {"sent": True, "cooldown_seconds": 60}
    ensure.assert_not_called()
    smtp_double.ssl.assert_not_called()
    smtp_double.starttls.assert_not_called()
    fake_db.session.commit.assert_called_once_with()
    assert len(email_store.rows) == 1
    assert email_store.rows[0].code_hash == hashlib.sha256(SYNTHETIC_CODE.encode()).hexdigest()
    assert "simulated" in caplog.text and SYNTHETIC_CODE not in caplog.text


@pytest.mark.parametrize("registered", [False, True])
def test_send_to_current_email_is_allowed_only_before_registration(
    client, modules, fake_db, member, email_store, mail_config, smtp_double, registered
):
    if registered:
        member.registered_at = FIXED_NOW - timedelta(days=1)
    response = client.post("/api/v1/me/email/code", json={"email": member.email.upper()})
    if registered:
        _assert_field_error(response, "email", "error.email_unchanged")
        smtp_double.ssl.assert_not_called()
        fake_db.session.commit.assert_not_called()
        email_store.query.filter_by.assert_not_called()
    else:
        assert response.status_code == 200
        smtp_double.smtp.send_message.assert_called_once()
        fake_db.session.commit.assert_called_once_with()


@pytest.mark.parametrize("email, key", [("", "error.field_required"), ("invalid", "error.email_invalid"), ("a@b.com\r\nBcc: x@y.com", "error.email_invalid")])
def test_send_invalid_email_never_locks_or_calls_smtp(
    client, fake_db, member, email_store, mail_config, smtp_double, email, key
):
    response = client.post("/api/v1/me/email/code", json={"email": email})
    _assert_field_error(response, "email", key)
    assert not fake_db.session.mock_calls
    smtp_double.ssl.assert_not_called()
    smtp_double.starttls.assert_not_called()


INVALID_CODE_STATES = ["missing", "wrong", "expired", "expiry_boundary", "used", "other_email", "other_user"]


@pytest.mark.parametrize("endpoint", ["registration", "email"])
@pytest.mark.parametrize("state", INVALID_CODE_STATES)
def test_production_invalid_expired_used_or_cross_identity_codes_are_rejected(
    client, modules, fake_db, member, email_store, endpoint, state
):
    email = "recipient@example.com"
    options = {"email": email}
    if state == "expired":
        options["expires_at"] = FIXED_NOW - timedelta(microseconds=1)
    elif state == "expiry_boundary":
        options["expires_at"] = FIXED_NOW
    elif state == "used":
        options["consumed_at"] = FIXED_NOW - timedelta(seconds=1)
    elif state == "other_email":
        options["email"] = member.email
    elif state == "other_user":
        options["user_id"] = member.id + 1
    record = None if state == "missing" else email_store.seed(**options)
    old_consumed_at = record.consumed_at if record is not None else None
    body = _registration_body(email=email, code="999999" if state == "wrong" else SYNTHETIC_CODE)
    before = member.to_dict()
    response = client.post(f"/api/v1/me/{endpoint}", json=body)
    _assert_field_error(response, "code", "error.email_code_invalid")
    assert member.to_dict() == before and member.registered_at is None
    if record is not None:
        assert record.consumed_at == old_consumed_at
    email_store.query.filter_by.assert_called_once_with(user_id=member.id, email=email, consumed_at=None)
    _assert_user_locked(fake_db, modules, member)
    fake_db.session.commit.assert_not_called()
    fake_db.session.add.assert_not_called()
    modules.me.audit.assert_not_called()


@pytest.mark.parametrize("code, key", [("", "error.field_required"), ("12345", "error.email_code_invalid"), ("1234567", "error.email_code_invalid"), ("12a456", "error.email_code_invalid"), ("１２３４５６", "error.email_code_invalid")])
@pytest.mark.parametrize("endpoint", ["registration", "email"])
def test_production_code_format_is_strict_before_query(
    client, fake_db, member, email_store, endpoint, code, key
):
    response = client.post(f"/api/v1/me/{endpoint}", json=_registration_body(email="recipient@example.com", code=code))
    _assert_field_error(response, "code", key)
    email_store.query.filter_by.assert_not_called()
    fake_db.session.commit.assert_not_called()
    assert member.registered_at is None


@pytest.mark.parametrize("remaining", [timedelta(microseconds=1), timedelta(minutes=10)])
def test_production_correct_code_consumes_exactly_once_and_uses_constant_time_comparison(
    app, modules, member, email_store, monkeypatch, remaining
):
    record = email_store.seed(expires_at=FIXED_NOW + remaining)
    compare = Mock(wraps=modules.me.secrets.compare_digest)
    monkeypatch.setattr(modules.me.secrets, "compare_digest", compare)
    with app.app_context():
        modules.me._consume_email_code(member, member.email, SYNTHETIC_CODE)
        assert record.consumed_at == FIXED_NOW
        with pytest.raises(modules.errors.ApiError) as raised:
            modules.me._consume_email_code(member, member.email, SYNTHETIC_CODE)
    assert raised.value.field_errors == [{"field": "code", "message_key": "error.email_code_invalid"}]
    compare.assert_called_once_with(record.code_hash, hashlib.sha256(SYNTHETIC_CODE.encode()).hexdigest())


@pytest.mark.parametrize("endpoint", ["registration", "email"])
def test_production_correct_code_commits_profile_and_cannot_be_reused(
    client, modules, fake_db, member, email_store, endpoint
):
    email = "recipient@example.com"
    record = email_store.seed(email=email)
    if endpoint == "email":
        member.registered_at = FIXED_NOW - timedelta(days=1)
    registered_before = member.registered_at
    response = client.post(f"/api/v1/me/{endpoint}", json=_registration_body(email=email, phone="0812345678"))
    assert response.status_code == 200
    assert response.get_json() == {"code": "OK", "data": member.to_dict()}
    assert member.email == email and record.consumed_at == FIXED_NOW
    assert member.registered_at == (FIXED_NOW if endpoint == "registration" else registered_before)
    fake_db.session.commit.assert_called_once_with()
    _assert_user_locked(fake_db, modules, member)
    modules.me.audit.assert_called_once()
    # Try consuming the same code through registration after email-change or through
    # email-change after registration: this avoids unchanged-email masking reuse.
    if endpoint == "email":
        member.registered_at = None
        replay_endpoint = "registration"
    else:
        member.email = "other@example.com"
        replay_endpoint = "email"
    response = client.post(f"/api/v1/me/{replay_endpoint}", json=_registration_body(email=email))
    _assert_field_error(response, "code", "error.email_code_invalid")
    assert fake_db.session.commit.call_count == 1


@pytest.mark.parametrize("endpoint", ["registration", "email"])
def test_resending_invalidates_old_code_even_after_new_code_is_consumed(
    client, app, modules, fake_db, member, email_store, mail_config, smtp_double, monkeypatch, endpoint
):
    email = "recipient@example.com"
    old = email_store.seed(email=email, code="111111")
    monkeypatch.setattr(modules.me.secrets, "randbelow", Mock(return_value=int(SYNTHETIC_CODE)))
    assert client.post("/api/v1/me/email/code", json={"email": email}).status_code == 200
    assert old.consumed_at == FIXED_NOW
    before = member.to_dict()
    response = client.post(f"/api/v1/me/{endpoint}", json=_registration_body(email=email, code="111111"))
    _assert_field_error(response, "code", "error.email_code_invalid")
    assert member.to_dict() == before and fake_db.session.commit.call_count == 1
    response = client.post(f"/api/v1/me/{endpoint}", json=_registration_body(email=email))
    assert response.status_code == 200 and fake_db.session.commit.call_count == 2
    with app.app_context(), pytest.raises(modules.errors.ApiError):
        modules.me._consume_email_code(member, email, "111111")


@pytest.mark.parametrize("endpoint", ["registration", "email"])
def test_dev_confirmation_does_not_require_a_real_code_record(
    client, app, fake_db, member, email_store, endpoint
):
    app.config["AUTH_DEV_MODE"] = True
    response = client.post(f"/api/v1/me/{endpoint}", json=_registration_body(email="recipient@example.com", code="synthetic-dev-code"))
    assert response.status_code == 200 and member.email == "recipient@example.com"
    email_store.query.filter_by.assert_not_called()
    fake_db.session.commit.assert_called_once_with()


@pytest.mark.parametrize("endpoint", ["email/code", "email"])
@pytest.mark.parametrize("email, key", [("SYNTHETIC@EXAMPLE.COM", "error.email_unchanged"), ("invalid", "error.email_invalid")])
def test_email_change_same_or_malformed_address_never_sends_or_commits(
    client, fake_db, member, email_store, mail_config, smtp_double, endpoint, email, key
):
    member.registered_at = FIXED_NOW - timedelta(days=1)
    before = member.to_dict()
    response = client.post(f"/api/v1/me/{endpoint}", json={"email": email, "code": SYNTHETIC_CODE})
    _assert_field_error(response, "email", key)
    assert member.to_dict() == before
    smtp_double.ssl.assert_not_called()
    smtp_double.starttls.assert_not_called()
    fake_db.session.commit.assert_not_called()
    email_store.query.filter_by.assert_not_called()


@pytest.mark.parametrize("endpoint", ["email/code", "email"])
def test_guest_cannot_request_or_confirm_email_change(
    client, fake_db, member, email_store, mail_config, smtp_double, endpoint
):
    member.line_provider = "guest"
    response = client.post(f"/api/v1/me/{endpoint}", json={"email": "recipient@example.com", "code": SYNTHETIC_CODE})
    _assert_error(response, 403, "PERMISSION_DENIED", "error.permission_denied")
    assert not fake_db.session.mock_calls
    smtp_double.ssl.assert_not_called()
    smtp_double.starttls.assert_not_called()


@pytest.mark.parametrize("endpoint", ["registration", "email"])
def test_changing_recipient_requires_new_send_before_confirmation(
    client, modules, fake_db, member, email_store, mail_config, smtp_double, monkeypatch, endpoint
):
    if endpoint == "email":
        member.registered_at = FIXED_NOW - timedelta(days=1)
    monkeypatch.setattr(modules.me.secrets, "randbelow", Mock(side_effect=[111111, 222222]))
    original_email = "first@example.com"
    changed_email = "second@example.com"
    assert client.post("/api/v1/me/email/code", json={"email": original_email}).status_code == 200
    before = member.to_dict()
    response = client.post(f"/api/v1/me/{endpoint}", json=_registration_body(email=changed_email, code="111111"))
    _assert_field_error(response, "code", "error.email_code_invalid")
    assert member.to_dict() == before and fake_db.session.commit.call_count == 1
    monkeypatch.setattr(modules.me, "_now", Mock(return_value=FIXED_NOW + timedelta(seconds=60)))
    assert client.post("/api/v1/me/email/code", json={"email": changed_email}).status_code == 200
    assert email_store.rows[0].consumed_at == FIXED_NOW + timedelta(seconds=60)
    response = client.post(f"/api/v1/me/{endpoint}", json=_registration_body(email=changed_email, code="222222"))
    assert response.status_code == 200 and member.email == changed_email
    assert email_store.rows[-1].consumed_at == FIXED_NOW + timedelta(seconds=60)
    assert fake_db.session.commit.call_count == 3
    assert [entry.args[0]["To"].addresses[0].addr_spec for entry in smtp_double.smtp.send_message.call_args_list] == [original_email, changed_email]


@pytest.mark.parametrize("endpoint", ["registration", "email"])
def test_profile_and_code_consumption_are_ready_in_the_same_commit(
    client, modules, fake_db, member, email_store, monkeypatch, endpoint
):
    record = email_store.seed(email="recipient@example.com")
    original_phone = member.phone
    original_registered_at = FIXED_NOW - timedelta(days=1)
    if endpoint == "email":
        member.registered_at = original_registered_at
    commit = fake_db.session.commit.side_effect
    avatar = "https://example.com/edited.png"

    def save_avatar(user, value):
        assert user is member and value == avatar
        user.avatar_url = value
        return "synthetic-old-avatar"

    monkeypatch.setattr(modules.me.avatars, "apply", Mock(side_effect=save_avatar))

    def atomic_commit():
        assert member.email == record.email == "recipient@example.com"
        assert record.consumed_at == FIXED_NOW
        if endpoint == "registration":
            assert member.registered_at == FIXED_NOW
            assert member.display_name == "Edited User" and member.phone == "0812345678"
            assert member.avatar_url == avatar
        else:
            assert member.registered_at == original_registered_at
            assert member.phone == original_phone and member.avatar_url == ""
        modules.me.audit.assert_not_called()
        modules.me.storage.delete.assert_not_called()
        commit()

    fake_db.session.commit.side_effect = atomic_commit
    response = client.post(
        f"/api/v1/me/{endpoint}",
        json=_registration_body(email="recipient@example.com", phone="0812345678", avatar_url=avatar),
    )
    assert response.status_code == 200
    fake_db.session.commit.assert_called_once_with()
    if endpoint == "registration":
        modules.me.storage.delete.assert_called_once_with("synthetic-old-avatar")
        modules.me.audit.assert_called_once_with("user.register", "user", str(member.id))
    else:
        modules.me.avatars.apply.assert_not_called()
        modules.me.audit.assert_called_once_with("me.email_change", "user", str(member.id), {"had_email": True})


@pytest.mark.parametrize("random_value, expected", [(0, "000000"), (999999, "999999")])
def test_generated_code_remains_six_digits_at_random_boundaries(
    client, modules, member, email_store, mail_config, smtp_double, monkeypatch, random_value, expected
):
    random = Mock(return_value=random_value)
    monkeypatch.setattr(modules.me.secrets, "randbelow", random)
    response = client.post("/api/v1/me/email/code", json={"email": "recipient@example.com"})
    assert response.status_code == 200
    random.assert_called_once_with(1_000_000)
    message = smtp_double.smtp.send_message.call_args.args[0]
    assert f"\n{expected}\n" in message.get_body(preferencelist=("plain",)).get_content()
    assert email_store.rows[0].code_hash == hashlib.sha256(expected.encode()).hexdigest()


# FR-SYS-012/013/016：默认开通一个月、到期硬停与到期提醒，全部跑在内存替身上。
PERSONAL_TENANT_ID = 11
ENTERPRISE_TENANT_ID = 201
# UTC naive 时钟；泰国时区（UTC+7）看到的是 2026-10-27 12:00，自然日 2026-10-27
PLAN_NOW = datetime(2026, 10, 27, 5, 0, 0)
# 提醒用的本期到期时间：泰国自然日 2026-11-20，和 PLAN_NOW 同一时刻偏移
PERIOD_END = datetime(2026, 11, 20, 5, 0, 0)


# ---------- 内存数据库替身 ----------
# 订阅与到期提醒依赖真实的查询语义（filter/filter_by/order_by/first/count/delete）
# 和唯一约束行为（并发撞键必须抛 IntegrityError），所以这里用内存表而不是裸 Mock。


def _order_spec(clause):
    """order_by 子句 → (列名, 是否倒序)：asc() / desc() / 裸列都要支持。"""
    element = getattr(clause, "element", clause)
    return element.key, getattr(clause, "modifier", None) is sa_operators.desc_op


def _sortable(value):
    # None 不能和 datetime/int 比较，统一降到最小档，避免排序抛 TypeError
    if value is None:
        return (0, 0.0, "")
    if isinstance(value, datetime):
        return (1, value.timestamp(), "")
    if isinstance(value, (bool, int, float)):
        return (1, float(value), "")
    return (2, 0.0, str(value))


def _matches(row, criterion):
    """SQLAlchemy 条件表达式 → 内存判定；未覆盖的算子直接失败，不静默放过。"""
    clauses = getattr(criterion, "clauses", None)
    if clauses is not None:  # and_() / or_() 组合（本套用例只会出现 and_）
        return all(_matches(row, clause) for clause in clauses)
    name = criterion.operator.__name__
    actual = getattr(row, criterion.left.key, None)
    expected = getattr(criterion.right, "value", None)  # SQL NULL 没有 bind 值
    if name == "in_op":
        return actual in (expected or ())
    if name in ("notin_op", "not_in_op"):
        return actual not in (expected or ())
    if name in ("eq", "is_"):
        return actual == expected
    if name in ("ne", "is_not", "isnot"):
        return actual != expected
    if name == "lt":
        return actual is not None and actual < expected
    if name == "le":
        return actual is not None and actual <= expected
    if name == "gt":
        return actual is not None and actual > expected
    if name == "ge":
        return actual is not None and actual >= expected
    raise AssertionError(f"in-memory query does not support operator {name!r}")


class _Query:
    """不可变查询：每次 filter/order_by/limit 都派生新对象，与 SQLAlchemy 语义一致。"""

    def __init__(self, table, predicates=(), order=(), limit=None):
        self._table = table
        self._predicates = tuple(predicates)
        self._order = tuple(order)
        self._limit = limit

    def _derive(self, *, predicates=None, order=None, limit=None):
        return _Query(
            self._table,
            self._predicates if predicates is None else predicates,
            self._order if order is None else order,
            self._limit if limit is None else limit,
        )

    def filter(self, *criteria):
        extra = tuple((lambda row, c=c: _matches(row, c)) for c in criteria)
        return self._derive(predicates=self._predicates + extra)

    def filter_by(self, **criteria):
        extra = tuple(
            (lambda row, k=k, v=v: getattr(row, k, None) == v) for k, v in criteria.items()
        )
        return self._derive(predicates=self._predicates + extra)

    def order_by(self, *clauses):
        return self._derive(order=self._order + clauses)

    def limit(self, value):
        return self._derive(limit=value)

    def all(self):
        rows = [row for row in self._table.rows if all(p(row) for p in self._predicates)]
        for clause in reversed(self._order):  # 稳定排序：次键先排，主键后排
            key, reverse = _order_spec(clause)
            rows.sort(key=lambda row, key=key: _sortable(getattr(row, key, None)), reverse=reverse)
        return rows if self._limit is None else rows[: self._limit]

    def first(self):
        return next(iter(self.all()), None)

    def one(self):
        rows = self.all()
        assert len(rows) == 1, f"expected exactly one row, got {len(rows)}"
        return rows[0]

    def count(self):
        return len(self.all())

    def delete(self, synchronize_session=False):
        assert synchronize_session is False
        rows = self.all()
        for row in rows:
            self._table.rows.remove(row)
        return len(rows)

    def update(self, values, synchronize_session=False):
        assert synchronize_session is False
        rows = self.all()
        for row in rows:
            for key, value in values.items():
                setattr(row, key, value)
        return len(rows)


class _Table:
    """内存表 + Model.query 替身；唯一键用列名元组表达。"""

    def __init__(self, model, unique=()):
        self.model = model
        self.unique = tuple(unique)
        self.rows = []
        # 必须先覆盖 query：Mock(wraps=...) 读属性会去取被包装类的同名属性，
        # 而 Model.query 在没有 db.init_app 的进程里会直接报错。
        proxy = Mock(name=model.__name__, wraps=model)
        proxy.query = _Query(self)
        for name in model.__mapper__.columns.keys():
            setattr(proxy, name, getattr(model, name))
        self.proxy = proxy

    def key_of(self, row, columns):
        return tuple(getattr(row, column, None) for column in columns)


class _Session:
    """最小 Session 替身：add/flush/commit/rollback/delete/get + 唯一约束。"""

    def __init__(self, tables):
        self.tables = list(tables)
        self.pending = []
        self.commits = 0
        self.flushes = 0
        self.rollbacks = 0
        self._sequences = {}

    def _table_for(self, obj):
        return next((table for table in self.tables if isinstance(obj, table.model)), None)

    def add(self, obj):
        self.pending.append(obj)

    def flush(self):
        self.flushes += 1
        while self.pending:
            obj = self.pending[0]
            table = self._table_for(obj)
            if table is None:
                self.pending.pop(0)
                continue
            if getattr(obj, "id", None) is None:
                name = table.model.__name__
                self._sequences[name] = self._sequences.get(name, 0) + 1
                obj.id = self._sequences[name]
            for columns in table.unique:
                key = table.key_of(obj, columns)
                if any(table.key_of(row, columns) == key for row in table.rows):
                    # 并发撞唯一约束：调用方必须 rollback 后按「别的实例已写」处理
                    raise IntegrityError(
                        f"synthetic unique violation {columns}", None, Exception("synthetic")
                    )
            table.rows.append(obj)
            self.pending.pop(0)

    def commit(self):
        self.flush()
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1
        self.pending.clear()

    def delete(self, obj):
        table = self._table_for(obj)
        if table is not None and obj in table.rows:
            table.rows.remove(obj)

    def get(self, model, pk):
        for table in self.tables:
            if model is table.model or model is table.proxy:
                return next((row for row in table.rows if getattr(row, "id", None) == pk), None)
        return None

    def query(self, *args, **kwargs):
        raise AssertionError("in-memory session has no aggregate query support")


_PLAN_TABLES = (
    ("Tenant", ()),
    ("User", ()),
    ("Enterprise", ()),
    ("Membership", ()),
    ("Application", ()),
    ("Subscription", (("tenant_id",),)),
    ("PlanReminder", (("tenant_id", "period_end", "stage"),)),
    ("Notification", ()),
    ("AuditEvent", ()),
)


@pytest.fixture
def plan_db(modules, fake_db, monkeypatch):
    """订阅/提醒用的内存库：表、固定时钟、模型替身与邮件替身一次装好。"""
    models = modules.models
    tables = {name: _Table(getattr(models, name), unique) for name, unique in _PLAN_TABLES}
    session = _Session(tables.values())
    database = SimpleNamespace(session=session)
    for module in (
        modules.auth, modules.subscriptions, modules.reminders,
        modules.quota, modules.plans, modules.me,
    ):
        monkeypatch.setattr(module, "db", database)
        for name, table in tables.items():
            if hasattr(module, name):
                monkeypatch.setattr(module, name, table.proxy)
    clock = Mock(name="plan_clock", return_value=PLAN_NOW)
    for module in (modules.subscriptions, modules.reminders):
        monkeypatch.setattr(module, "_now", clock)
    mail = Mock(name="send_plan_reminder")
    monkeypatch.setattr(modules.reminders.email_sender, "send_plan_reminder", mail)

    def store(row):
        session.add(row)
        session.flush()
        return row

    def tenant(tenant_id, tenant_type="PERSONAL", owner_user_id=None, name=None,
               status="ACTIVE", created_at=None):
        return store(models.Tenant(
            id=tenant_id, tenant_type=tenant_type, owner_user_id=owner_user_id,
            display_name=name or "Synthetic Tenant", status=status,
            created_at=created_at or PLAN_NOW,
        ))

    def user(user_id=101, provider="line", registered=True, language="en",
             email="synthetic@example.com"):
        return store(models.User(
            id=user_id, line_provider=provider, line_sub=f"{provider}:{user_id}",
            status="ACTIVE", display_name="Synthetic User", avatar_url="", avatar_path="",
            language=language, phone="", email=email,
            registered_at=PLAN_NOW if registered else None,
        ))

    def enterprise(tenant_id, status="VERIFIED", verified_at=PLAN_NOW):
        return store(models.Enterprise(
            tenant_id=tenant_id, status=status, legal_name="Synthetic Co",
            code=f"ent-{tenant_id}", verified_at=verified_at,
        ))

    def membership(tenant_id, user_id, role="MEMBER", status="ACTIVE", created_at=PLAN_NOW):
        return store(models.Membership(
            tenant_id=tenant_id, user_id=user_id, role=role, status=status, created_at=created_at,
        ))

    def application(tenant_id=PERSONAL_TENANT_ID, user_id=101, status="APPROVED",
                    code="STARTER", form=None, submitted_at=PLAN_NOW, updated_at=PLAN_NOW):
        body = {"plan_code": code, "plan_name": code.title()}
        body.update(form or {})
        return store(models.Application(
            type="PLAN_UPGRADE", applicant_user_id=user_id, target_tenant_id=tenant_id,
            status=status, form=body, submitted_at=submitted_at, updated_at=updated_at,
        ))

    def subscription(tenant_id=PERSONAL_TENANT_ID, plan_code="KINDER", source="DEFAULT",
                     starts_at=None, expires_at=None, application_id=None):
        return store(models.Subscription(
            tenant_id=tenant_id, plan_code=plan_code, source=source,
            starts_at=starts_at or PLAN_NOW,
            expires_at=expires_at or modules.subscriptions.add_months(PLAN_NOW, 1),
            application_id=application_id,
        ))

    def notification(user_id, type_="PLAN_EXPIRING", created_at=None, read_at=None):
        return store(models.Notification(
            user_id=user_id, type=type_, title="synthetic", body="synthetic",
            read_at=read_at, created_at=created_at or PLAN_NOW,
        ))

    return SimpleNamespace(
        tables=tables, session=session, mail=mail, clock=clock, store=store,
        tenant=tenant, user=user, enterprise=enterprise, membership=membership,
        application=application, subscription=subscription, notification=notification,
    )


def _ocr_job_stub(tenant_id=PERSONAL_TENANT_ID, user_id=101):
    return SimpleNamespace(id="synthetic-job", tenant_id=tenant_id, created_by_user_id=user_id)


# ---------- 默认开通：每个租户 Kinder 一个月 ----------


@pytest.mark.parametrize(
    "kind, active",
    [("personal", True), ("guest", True), ("enterprise_verified", True),
     ("enterprise_unverified", False)],
)
def test_default_activation_grants_kinder_for_exactly_one_month(modules, plan_db, kind, active):
    subs = modules.subscriptions
    created = datetime(2026, 10, 20, 5, 0, 0)
    verified = datetime(2026, 10, 25, 5, 0, 0)
    if kind in ("personal", "guest"):
        owner = plan_db.user(provider="guest" if kind == "guest" else "line",
                             registered=kind != "guest")
        plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=owner.id, created_at=created)
        tenant_id, start = PERSONAL_TENANT_ID, created
    else:
        plan_db.tenant(ENTERPRISE_TENANT_ID, "ENTERPRISE", created_at=created)
        plan_db.enterprise(
            ENTERPRISE_TENANT_ID,
            status="VERIFIED" if kind == "enterprise_verified" else "PENDING",
            verified_at=verified,
        )
        tenant_id, start = ENTERPRISE_TENANT_ID, verified

    state = modules.plans.subscription_state(tenant_id)
    if not active:
        # 企业未认证既不开通也不提醒：没有 Free 档位可以兜底
        assert state == {
            "status": "NONE", "plan_code": None, "plan_name": None, "source": None,
            "application_id": None, "starts_at": None, "expires_at": None,
            "days_remaining": None, "pending": None,
        }
        assert plan_db.tables["Subscription"].rows == []
        return
    expires = subs.add_months(start, 1)
    assert state == {
        "status": "ACTIVE", "plan_code": "KINDER", "plan_name": "Kinder", "source": "DEFAULT",
        "application_id": None, "starts_at": start.isoformat(),
        "expires_at": expires.isoformat(),
        "days_remaining": (subs.local_date(expires) - subs.local_date(PLAN_NOW)).days,
        "pending": None,
    }
    row, = plan_db.tables["Subscription"].rows
    assert (row.tenant_id, row.plan_code, row.source) == (tenant_id, "KINDER", "DEFAULT")
    # 一个租户永远只有一行订阅：重复读取不会再开通一次
    assert modules.plans.subscription_state(tenant_id)["expires_at"] == expires.isoformat()
    assert len(plan_db.tables["Subscription"].rows) == 1


def test_enterprise_verified_without_timestamp_is_backfilled_before_activation(modules, plan_db):
    plan_db.tenant(ENTERPRISE_TENANT_ID, "ENTERPRISE", name="Synthetic Enterprise")
    enterprise = plan_db.enterprise(ENTERPRISE_TENANT_ID, verified_at=None)
    state = modules.plans.subscription_state(ENTERPRISE_TENANT_ID)
    # 企业认证是人工改 status 的流程，没有状态翻转钩子：首次看到 VERIFIED 时补填
    assert enterprise.verified_at == PLAN_NOW
    assert state["status"] == "ACTIVE" and state["starts_at"] == PLAN_NOW.isoformat()
    assert state["expires_at"] == modules.subscriptions.add_months(PLAN_NOW, 1).isoformat()


def test_concurrent_first_activation_is_absorbed_by_the_unique_constraint(
    modules, plan_db, monkeypatch
):
    owner = plan_db.user()
    tenant = plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=owner.id)
    existing = plan_db.subscription(expires_at=PERIOD_END)
    # 模拟并发：本请求的「先查」没看到另一实例刚插入的行，只剩唯一约束兜底
    monkeypatch.setattr(
        modules.subscriptions.Subscription, "query",
        _Query(plan_db.tables["Subscription"], predicates=(lambda row: False,)),
    )
    assert modules.subscriptions.ensure_subscription(tenant) is None
    assert plan_db.session.rollbacks == 1
    assert plan_db.tables["Subscription"].rows == [existing]
    # 并发落败方不发开通通知（胜出方已发）
    assert plan_db.tables["Notification"].rows == []


# ---------- 开通通知：个人账户开通 / 公司账户开通 ----------


@pytest.mark.parametrize(
    "kind, language, expected",
    [
        ("personal", "en", ("ACCOUNT_ACTIVATED", "Account activated", "Your Kinder plan is active until {d}.")),
        ("personal", "th", ("ACCOUNT_ACTIVATED", "เปิดใช้งานบัญชีแล้ว", "แพ็กเกจ Kinder ของคุณใช้งานได้ถึงวันที่ {d}")),
        ("enterprise", "en", ("COMPANY_ACTIVATED", "Company account activated", "Synthetic Co: Kinder plan is active until {d}.")),
        ("enterprise", "th", ("COMPANY_ACTIVATED", "เปิดใช้งานบัญชีบริษัทแล้ว", "Synthetic Co: แพ็กเกจ Kinder ใช้งานได้ถึงวันที่ {d}")),
    ],
)
def test_first_activation_notifies_account_owner_once(modules, plan_db, kind, language, expected):
    subs = modules.subscriptions
    owner = plan_db.user(language=language)
    if kind == "personal":
        plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=owner.id)
        tenant_id = PERSONAL_TENANT_ID
    else:
        plan_db.tenant(ENTERPRISE_TENANT_ID, "ENTERPRISE", name="Stale display name")
        plan_db.enterprise(ENTERPRISE_TENANT_ID)
        plan_db.user(user_id=102)
        plan_db.membership(ENTERPRISE_TENANT_ID, 102, role="MEMBER", created_at=PLAN_NOW - timedelta(days=1))
        plan_db.membership(ENTERPRISE_TENANT_ID, owner.id, role="OWNER")
        tenant_id = ENTERPRISE_TENANT_ID
    modules.plans.subscription_state(tenant_id)
    modules.plans.subscription_state(tenant_id)  # 再读一次不重复发
    row, = plan_db.tables["Subscription"].rows
    note, = plan_db.tables["Notification"].rows
    until = subs.local_date(row.expires_at).isoformat()
    type_, title, body = expected
    assert (note.user_id, note.type, note.title, note.body) == (owner.id, type_, title, body.format(d=until))
    assert note.type in modules.auth.ACCOUNT_NOTIFICATION_TYPES


@pytest.mark.parametrize("kind", ["guest", "enterprise_unverified", "existing"])
def test_activation_notice_skips_guest_unverified_and_existing(modules, plan_db, kind):
    if kind == "guest":
        guest = plan_db.user(provider="guest", registered=False)
        plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=guest.id)
        tenant_id = PERSONAL_TENANT_ID
    elif kind == "enterprise_unverified":
        plan_db.user()
        plan_db.tenant(ENTERPRISE_TENANT_ID, "ENTERPRISE")
        plan_db.enterprise(ENTERPRISE_TENANT_ID, status="PENDING_VERIFICATION")
        plan_db.membership(ENTERPRISE_TENANT_ID, 101, role="OWNER")
        tenant_id = ENTERPRISE_TENANT_ID
    else:
        plan_db.user()
        plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=101)
        plan_db.subscription()
        tenant_id = PERSONAL_TENANT_ID
    modules.plans.subscription_state(tenant_id)
    assert plan_db.tables["Notification"].rows == []


# ---------- 到期即硬停 ----------


def test_expired_subscription_hard_stops_new_ocr_tasks(modules, plan_db):
    plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=101)
    plan_db.subscription(
        starts_at=datetime(2026, 9, 20, 5), expires_at=datetime(2026, 10, 20, 5),
    )
    state = modules.plans.subscription_state(PERSONAL_TENANT_ID)
    assert state["status"] == "EXPIRED" and state["days_remaining"] == -7
    assert modules.quota.entitled_plan(PERSONAL_TENANT_ID) is None
    with pytest.raises(modules.errors.ApiError) as raised:
        modules.quota.check_and_consume(_ocr_job_stub())
    assert (raised.value.http_status, raised.value.code) == (402, "PLAN_EXPIRED")
    assert raised.value.message_key == "plan.expired"
    # 硬停不写任何行：续费只能由人工审批写入有效期
    assert plan_db.tables["Application"].rows == []


def test_unverified_enterprise_is_blocked_exactly_like_an_expired_plan(modules, plan_db):
    plan_db.tenant(ENTERPRISE_TENANT_ID, "ENTERPRISE", name="Synthetic Enterprise")
    plan_db.enterprise(ENTERPRISE_TENANT_ID, status="PENDING")
    with pytest.raises(modules.errors.ApiError) as raised:
        modules.quota.check_and_consume(_ocr_job_stub(ENTERPRISE_TENANT_ID))
    assert (raised.value.http_status, raised.value.code) == (402, "PLAN_EXPIRED")
    assert plan_db.tables["Subscription"].rows == []


@pytest.mark.parametrize("used, rejected", [(0, False), (999, False), (1000, True), (1001, True)])
def test_active_plan_rejects_only_after_monthly_pages_are_exhausted(
    modules, plan_db, monkeypatch, used, rejected
):
    plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=101)
    pages = Mock(return_value=used)
    monkeypatch.setattr(modules.quota, "pages_used", pages)
    if rejected:
        with pytest.raises(modules.errors.ApiError) as raised:
            modules.quota.check_and_consume(_ocr_job_stub())
        assert (raised.value.http_status, raised.value.code) == (402, "QUOTA_EXCEEDED")
        assert raised.value.message_key == "quota.exceeded"
    else:
        assert modules.quota.check_and_consume(_ocr_job_stub()) is None
    pages.assert_called_once_with(PERSONAL_TENANT_ID)
    # 页数即消耗：门禁既不写赠送流水也不提前提交任务事务
    assert plan_db.session.commits == 0
    assert modules.quota.entitled_plan(PERSONAL_TENANT_ID)["source"] == "DEFAULT"


# ---------- 人工审批续费 ----------


@pytest.mark.parametrize(
    "scenario", ["before_expiry", "after_expiry", "manual_dates", "period_months"],
)
def test_approved_application_renews_once_from_the_right_starting_point(
    modules, plan_db, scenario
):
    subs = modules.subscriptions
    plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=101)
    current_end = (
        PLAN_NOW - timedelta(days=5) if scenario == "after_expiry"
        else PLAN_NOW + timedelta(days=10)
    )
    row = plan_db.subscription(starts_at=PLAN_NOW - timedelta(days=20), expires_at=current_end)
    form = {
        "manual_dates": {"valid_from": "2027-01-01", "valid_to": "2027-07-01"},
        "period_months": {"period_months": 6},
    }.get(scenario, {})
    application = plan_db.application(code="STARTER", form=form)

    state = modules.plans.subscription_state(PERSONAL_TENANT_ID)
    expected_start = {
        "before_expiry": current_end,      # 未到期续费从当期到期日接续，不浪费剩余天数
        "after_expiry": PLAN_NOW,          # 已过期续费从现在起算
        "manual_dates": datetime(2027, 1, 1),
        "period_months": current_end,
    }[scenario]
    expected_end = {
        "before_expiry": subs.add_months(current_end, 12),
        "after_expiry": subs.add_months(PLAN_NOW, 12),
        "manual_dates": datetime(2027, 7, 1),
        "period_months": subs.add_months(current_end, 6),
    }[scenario]
    assert state["status"] == "ACTIVE" and state["source"] == "APPROVED"
    assert state["plan_code"] == "STARTER" and state["plan_name"] == "Starter"
    assert state["application_id"] == application.id
    assert state["starts_at"] == expected_start.isoformat()
    assert state["expires_at"] == expected_end.isoformat()
    # 同一条申请只生效一次：再读一次不会在新的到期日上继续叠加
    again = modules.plans.subscription_state(PERSONAL_TENANT_ID)
    assert again["expires_at"] == expected_end.isoformat()
    assert row.application_id == application.id
    assert len(plan_db.tables["Subscription"].rows) == 1


def test_only_the_latest_approved_application_is_applied_and_rejected_ones_are_ignored(
    modules, plan_db
):
    plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=101)
    plan_db.subscription(expires_at=PLAN_NOW + timedelta(days=10))
    plan_db.application(code="ADVANCE", status="REJECTED", updated_at=PLAN_NOW + timedelta(days=3))
    plan_db.application(code="ADVANCE", tenant_id=999, updated_at=PLAN_NOW + timedelta(days=3))
    plan_db.application(code="KINDER", updated_at=PLAN_NOW)
    latest = plan_db.application(
        code="INTERMEDIATE", form={"period_months": 3}, updated_at=PLAN_NOW + timedelta(days=1),
    )
    state = modules.plans.subscription_state(PERSONAL_TENANT_ID)
    assert state["plan_code"] == "INTERMEDIATE" and state["application_id"] == latest.id
    assert state["expires_at"] == modules.subscriptions.add_months(
        PLAN_NOW + timedelta(days=10), 3
    ).isoformat()


@pytest.mark.parametrize(
    "requested, status, message_key",
    [("STARTER", 201, None), ("ADVANCE", 201, None), ("KINDER", 409, "plan.not_upgrade")],
)
def test_same_tier_renewal_is_allowed_while_downgrade_is_rejected(
    client, modules, plan_db, monkeypatch, requested, status, message_key
):
    user = plan_db.user()
    tenant = plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=user.id)
    plan_db.subscription(
        plan_code="STARTER", source="APPROVED", expires_at=PLAN_NOW + timedelta(days=30),
    )
    monkeypatch.setattr(modules.plans, "current_user", Mock(return_value=user))
    monkeypatch.setattr(modules.plans, "resolve_tenant", Mock(return_value=tenant))
    response = client.post("/api/v1/me/plan-applications", json={"plan_code": requested})
    assert response.status_code == status
    if message_key:
        _assert_error(response, 409, "STATE_CONFLICT", message_key)
        assert plan_db.tables["Application"].rows == []
        return
    row, = plan_db.tables["Application"].rows
    assert row.status == "SUBMITTED" and row.form["plan_code"] == requested
    # 申请只登记意向：当前权益与到期日完全不动，等人工审批写入有效期
    data = response.get_json()["data"]
    assert data["status"] == "ACTIVE" and data["plan_code"] == "STARTER"
    assert data["expires_at"] == (PLAN_NOW + timedelta(days=30)).isoformat()
    assert data["pending"]["plan_code"] == requested


def test_a_pending_application_blocks_a_second_one_without_changing_the_plan(
    client, modules, plan_db, monkeypatch
):
    user = plan_db.user()
    tenant = plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=user.id)
    plan_db.application(code="ADVANCE", status="UNDER_REVIEW")
    monkeypatch.setattr(modules.plans, "current_user", Mock(return_value=user))
    monkeypatch.setattr(modules.plans, "resolve_tenant", Mock(return_value=tenant))
    response = client.post("/api/v1/me/plan-applications", json={"plan_code": "ADVANCE"})
    _assert_error(response, 409, "STATE_CONFLICT", "plan.application_pending")
    assert len(plan_db.tables["Application"].rows) == 1
    state = modules.plans.subscription_state(PERSONAL_TENANT_ID)
    assert state["status"] == "ACTIVE" and state["plan_code"] == "KINDER"
    assert state["pending"]["plan_code"] == "ADVANCE"


# ---------- 套餐配置（FR-SYS-019）：plans 表驱动，改动对存量订阅立即生效 ----------


def _configure_plans(plan_catalog, **changes):
    """以内置种子为底，按 code 覆盖字段后作为 plans 表内容（并清缓存）。"""
    rows = plan_catalog.module.load_seed()
    for row in rows:
        row.update(changes.get(row["code"], {}))
    plan_catalog.rows[:] = rows
    plan_catalog.module.invalidate()


def test_default_plan_and_trial_months_come_from_configuration(modules, plan_db, plan_catalog):
    _configure_plans(
        plan_catalog,
        KINDER={"is_default": False},
        STARTER={"is_default": True, "trial_months": 2},
    )
    created = datetime(2026, 10, 20, 5, 0, 0)
    owner = plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=owner.id, created_at=created)
    state = modules.plans.subscription_state(PERSONAL_TENANT_ID)
    assert (state["plan_code"], state["plan_name"], state["source"]) == ("STARTER", "Starter", "DEFAULT")
    assert state["expires_at"] == modules.subscriptions.add_months(created, 2).isoformat()


def test_page_quota_changes_apply_immediately_to_existing_subscriptions(
    modules, plan_db, plan_catalog, monkeypatch
):
    plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=101)
    plan_db.subscription(expires_at=PLAN_NOW + timedelta(days=10))
    monkeypatch.setattr(modules.quota, "pages_used", Mock(return_value=1500))
    job = _ocr_job_stub()
    # 种子 Kinder 1,000 页：本月已用 1,500 页 → 额度用尽
    with pytest.raises(modules.errors.ApiError) as exc:
        modules.quota.check_and_consume(job)
    assert exc.value.code == "QUOTA_EXCEEDED"
    # 运维把 Kinder 调到 2,000 页：同一条存量订阅立即按新额度计量（不做快照）
    _configure_plans(plan_catalog, KINDER={"quota_pages_per_month": 2000})
    modules.quota.check_and_consume(job)
    plan = modules.quota.entitled_plan(PERSONAL_TENANT_ID)
    assert modules.quota.pages_view(plan, PERSONAL_TENANT_ID) == {"monthly_total": 2000, "remaining": 500}


def test_approval_without_dates_uses_the_plans_configured_renewal_months(
    modules, plan_db, plan_catalog
):
    _configure_plans(plan_catalog, STARTER={"approved_period_months": 6})
    plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=101)
    plan_db.subscription(expires_at=PLAN_NOW - timedelta(days=1))
    plan_db.application(code="STARTER")
    state = modules.plans.subscription_state(PERSONAL_TENANT_ID)
    assert state["plan_code"] == "STARTER"
    assert state["expires_at"] == modules.subscriptions.add_months(PLAN_NOW, 6).isoformat()


def test_activation_notice_uses_the_plan_name_in_the_recipients_language(
    modules, plan_db, plan_catalog
):
    _configure_plans(plan_catalog, KINDER={"name": {"en": "Kinder", "th": "คินเดอร์"}})
    owner = plan_db.user(language="th")
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=owner.id)
    modules.plans.subscription_state(PERSONAL_TENANT_ID)
    note, = plan_db.tables["Notification"].rows
    assert "แพ็กเกจ คินเดอร์" in note.body


def test_plan_catalog_endpoint_is_bilingual_and_hides_disabled_plans(
    client, modules, plan_db, plan_catalog, monkeypatch
):
    _configure_plans(plan_catalog, INTERMEDIATE={"status": "DISABLED"})
    response = client.get("/api/v1/plans")
    assert response.status_code == 200
    data = response.get_json()["data"]
    assert (data["currency"], data["payment"]) == ("THB", "OFFLINE")
    assert [p["code"] for p in data["items"]] == ["KINDER", "STARTER", "ADVANCE"]
    kinder, starter, advance = data["items"]
    # 只暴露展示字段（含用于预选的 is_default）；试用/续期月数等后台规则不出现在公开目录
    assert set(kinder) == {
        "code", "name", "price", "quota_pages_per_month", "seats", "features", "theme",
        "is_default", "i18n",
    }
    assert (kinder["is_default"], starter["is_default"]) == (True, False)
    assert kinder["price"] == {"monthly_thb": None, "yearly_thb": 888, "display": "THB 888 / year"}
    assert kinder["i18n"]["th"]["price_display"] == "THB 888 / ปี"
    assert starter["i18n"]["th"]["features"] == ["ขั้นตอนการอนุมัติ", "แจ้งเตือนทางอีเมล"]
    assert (kinder["theme"], advance["theme"]) == ("DEFAULT", "DARK")

    # 停用的套餐不可申请
    user = plan_db.user()
    tenant = plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=user.id)
    monkeypatch.setattr(modules.plans, "current_user", Mock(return_value=user))
    monkeypatch.setattr(modules.plans, "resolve_tenant", Mock(return_value=tenant))
    response = client.post("/api/v1/me/plan-applications", json={"plan_code": "INTERMEDIATE"})
    assert response.status_code == 400
    assert plan_db.tables["Application"].rows == []


def test_disabled_plan_keeps_metering_existing_subscriptions(modules, plan_db, plan_catalog):
    _configure_plans(plan_catalog, INTERMEDIATE={"status": "DISABLED"})
    plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=101)
    plan_db.subscription(plan_code="INTERMEDIATE", source="APPROVED",
                         expires_at=PLAN_NOW + timedelta(days=30))
    plan = modules.quota.entitled_plan(PERSONAL_TENANT_ID)
    assert (plan["code"], plan["quota_pages_per_month"]) == ("INTERMEDIATE", 10000)
    assert modules.plans.plan_rank("INTERMEDIATE") > modules.plans.plan_rank("STARTER")


# ---------- /me/quota 汇总 ----------


@pytest.mark.parametrize("scenario", ["default", "approved", "expired", "unverified_enterprise"])
def test_quota_summary_exposes_plan_subscription_and_pages_only(
    client, modules, plan_db, monkeypatch, scenario
):
    user = plan_db.user()
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=user.id)
    plan_db.tenant(ENTERPRISE_TENANT_ID, "ENTERPRISE", name="Synthetic Enterprise")
    plan_db.enterprise(
        ENTERPRISE_TENANT_ID,
        status="PENDING" if scenario == "unverified_enterprise" else "VERIFIED",
    )
    if scenario == "approved":
        plan_db.application(code="ADVANCE")
    if scenario == "expired":
        plan_db.subscription(expires_at=PLAN_NOW - timedelta(days=1))
    monkeypatch.setattr(modules.workspace, "list_tenants", Mock(return_value=[
        {"tenant_id": PERSONAL_TENANT_ID, "tenant_type": "PERSONAL", "name": None, "role": None},
        {"tenant_id": ENTERPRISE_TENANT_ID, "tenant_type": "ENTERPRISE",
         "name": "Synthetic Enterprise", "role": "OWNER"},
    ]))
    monkeypatch.setattr(modules.quota, "pages_used", Mock(return_value=125))
    monkeypatch.setattr(modules.me, "current_user", Mock(return_value=user))

    response = client.get("/api/v1/me/quota")
    assert response.status_code == 200
    personal, enterprise = response.get_json()["data"]["tenants"]
    # 三段结构：plan / subscription / pages；没有 free_tasks，也没有 paid_pages
    assert set(personal) == {"tenant_id", "tenant_type", "name", "plan", "subscription", "pages"}
    code = "ADVANCE" if scenario == "approved" else "KINDER"
    total = 100000 if scenario == "approved" else 1000
    active = scenario != "expired"
    assert personal["plan"] == {
        "code": code, "name": code.title(), "is_paid": scenario == "approved",
        "name_i18n": {"en": code.title(), "th": code.title()},
        "source": "APPROVED" if scenario == "approved" else "DEFAULT",
        "metering": "OCR_PAGE",
    }
    assert personal["subscription"]["status"] == ("ACTIVE" if active else "EXPIRED")
    assert personal["pages"] == {
        "monthly_total": total, "remaining": total - 125 if active else 0,
    }
    if scenario == "unverified_enterprise":
        assert enterprise["plan"] == {
            "code": None, "name": None, "name_i18n": None, "is_paid": False, "source": None,
            "metering": "OCR_PAGE",
        }
        assert enterprise["subscription"] == {
            "status": "NONE", "starts_at": None, "expires_at": None, "days_remaining": None,
        }
        assert enterprise["pages"] == {"monthly_total": 0, "remaining": 0}
    else:
        assert enterprise["plan"]["code"] == "KINDER"
        assert enterprise["subscription"]["status"] == "ACTIVE"
        assert enterprise["pages"] == {"monthly_total": 1000, "remaining": 875}


# ---------- 到期提醒引擎（FR-SYS-012/013） ----------


@pytest.fixture
def reminder_world(modules, plan_db):
    """一个个人租户 + 一行订阅；到期节点由 sweep(now) 相对 PERIOD_END 移动。"""
    owner = plan_db.user(email="owner@example.com")
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=owner.id)
    row = plan_db.subscription(expires_at=PERIOD_END)
    return SimpleNamespace(owner=owner, subscription=row)


def test_stage_for_maps_only_the_five_cadence_points(modules):
    reminders = modules.reminders
    assert reminders.STAGES == ("D7", "D3", "D1", "D0", "EXPIRED")
    # 7/3/1/0 各一个节点，其余天数一律不提醒（错过的节点不补发）
    assert {days: reminders.stage_for(days) for days in range(0, 9)} == {
        0: "D0", 1: "D1", 2: None, 3: "D3", 4: None, 5: None, 6: None, 7: "D7", 8: None,
    }
    assert {reminders.stage_for(days) for days in (-1, -2, -365)} == {"EXPIRED"}


@pytest.mark.parametrize(
    "days_left, stage, type_",
    [(7, "D7", "PLAN_EXPIRING"), (3, "D3", "PLAN_EXPIRING"), (1, "D1", "PLAN_EXPIRING"),
     (0, "D0", "PLAN_EXPIRING"), (-1, "EXPIRED", "PLAN_EXPIRED")],
)
def test_each_reminder_stage_fires_once_with_plan_name_and_expiry_date(
    modules, plan_db, reminder_world, days_left, stage, type_
):
    moment = PERIOD_END - timedelta(days=days_left)
    assert modules.reminders.sweep(moment) == {
        "scanned": 1, "notified": 1, "emailed": 1, "skipped": 0,
    }
    record, = plan_db.tables["PlanReminder"].rows
    # 幂等键 = (tenant_id, period_end, stage)，period_end 取本期 expires_at
    assert (record.tenant_id, record.period_end, record.stage) == (
        PERSONAL_TENANT_ID, PERIOD_END, stage,
    )
    assert record.email_sent is True
    note, = plan_db.tables["Notification"].rows
    assert (note.type, note.user_id) == (type_, reminder_world.owner.id)
    assert "Kinder" in note.title and "2026-11-20" in note.body
    assert plan_db.mail.call_args == call(
        "owner@example.com", plan_name="Kinder", expires_on="2026-11-20",
        days_left=days_left, stage=stage, language="en",
    )
    # 同一节点重复 sweep 不再发送（本地与 Cloud Run 共用一个库）
    assert modules.reminders.sweep(moment) == {
        "scanned": 1, "notified": 0, "emailed": 0, "skipped": 1,
    }
    assert len(plan_db.tables["PlanReminder"].rows) == 1
    assert len(plan_db.tables["Notification"].rows) == 1
    assert plan_db.mail.call_count == 1


@pytest.mark.parametrize("days_left", [30, 10, 5, 4, 2])
def test_missed_stages_are_never_back_filled(modules, plan_db, reminder_world, days_left):
    assert modules.reminders.sweep(PERIOD_END - timedelta(days=days_left)) == {
        "scanned": 1, "notified": 0, "emailed": 0, "skipped": 1,
    }
    assert plan_db.tables["PlanReminder"].rows == []
    # 进程停了两天后恢复：只按当天剩余天数落一个节点，绝不补发 D7+D3
    assert modules.reminders.sweep(PERIOD_END - timedelta(days=1))["notified"] == 1
    assert [row.stage for row in plan_db.tables["PlanReminder"].rows] == ["D1"]
    assert len(plan_db.tables["Notification"].rows) == 1


def test_expired_stage_is_sent_once_per_period_and_renewal_restarts_the_cadence(
    modules, plan_db, reminder_world
):
    for offset in (1, 2, 30):
        modules.reminders.sweep(PERIOD_END + timedelta(days=offset))
    assert [row.stage for row in plan_db.tables["PlanReminder"].rows] == ["EXPIRED"]
    assert len(plan_db.tables["Notification"].rows) == 1
    # 续费改写 expires_at → period_end 变成新值 → 新周期自然重新按节点提醒
    reminder_world.subscription.expires_at = PERIOD_END + timedelta(days=37)
    assert modules.reminders.sweep(PERIOD_END + timedelta(days=30))["notified"] == 1
    assert [row.stage for row in plan_db.tables["PlanReminder"].rows] == ["EXPIRED", "D7"]


def test_guests_are_never_reminded(modules, plan_db):
    guest = plan_db.user(provider="guest", registered=False, email="")
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=guest.id, name="Guest")
    plan_db.subscription(expires_at=PERIOD_END)
    for days_left in (7, 3, 1, 0, -1):
        assert modules.reminders.sweep(PERIOD_END - timedelta(days=days_left)) == {
            "scanned": 1, "notified": 0, "emailed": 0, "skipped": 1,
        }
    assert plan_db.tables["PlanReminder"].rows == []
    assert plan_db.tables["Notification"].rows == []
    plan_db.mail.assert_not_called()


@pytest.mark.parametrize("newest_role", ["OWNER", "MEMBER"])
def test_enterprise_reminder_goes_to_owner_then_earliest_active_member(
    modules, plan_db, newest_role
):
    plan_db.tenant(ENTERPRISE_TENANT_ID, "ENTERPRISE", name="Synthetic Enterprise")
    plan_db.enterprise(ENTERPRISE_TENANT_ID)
    early = plan_db.user(user_id=401, email="early@example.com")
    newest = plan_db.user(user_id=402, email="newest@example.com", language="th")
    removed = plan_db.user(user_id=403, email="removed@example.com")
    plan_db.membership(ENTERPRISE_TENANT_ID, removed.id, role="OWNER", status="REMOVED",
                       created_at=PLAN_NOW - timedelta(days=9))
    plan_db.membership(ENTERPRISE_TENANT_ID, early.id,
                       created_at=PLAN_NOW - timedelta(days=5))
    plan_db.membership(ENTERPRISE_TENANT_ID, newest.id, role=newest_role,
                       created_at=PLAN_NOW - timedelta(days=1))
    plan_db.subscription(tenant_id=ENTERPRISE_TENANT_ID, expires_at=PERIOD_END)

    assert modules.reminders.sweep(PERIOD_END - timedelta(days=3))["notified"] == 1
    note, = plan_db.tables["Notification"].rows
    # 有 OWNER 就发 OWNER，没有 OWNER 退回最早加入的 ACTIVE 成员；已移除成员不收
    expected = newest if newest_role == "OWNER" else early
    assert note.user_id == expected.id
    assert plan_db.mail.call_args.args == (expected.email,)
    assert plan_db.mail.call_args.kwargs["language"] == (
        "th" if newest_role == "OWNER" else "en"
    )


def test_enterprise_without_active_members_is_skipped_without_writing_anything(modules, plan_db):
    plan_db.tenant(ENTERPRISE_TENANT_ID, "ENTERPRISE", name="Synthetic Enterprise")
    plan_db.enterprise(ENTERPRISE_TENANT_ID)
    plan_db.membership(ENTERPRISE_TENANT_ID, 401, role="OWNER", status="REMOVED")
    plan_db.subscription(tenant_id=ENTERPRISE_TENANT_ID, expires_at=PERIOD_END)
    assert modules.reminders.sweep(PERIOD_END - timedelta(days=7)) == {
        "scanned": 1, "notified": 0, "emailed": 0, "skipped": 1,
    }
    assert plan_db.tables["PlanReminder"].rows == []


@pytest.mark.parametrize("gap", ["no_email", "unregistered"])
def test_users_without_a_usable_mailbox_get_the_in_app_reminder_only(modules, plan_db, gap):
    owner = plan_db.user(
        email="" if gap == "no_email" else "owner@example.com",
        registered=gap != "unregistered",
    )
    plan_db.tenant(PERSONAL_TENANT_ID, owner_user_id=owner.id)
    plan_db.subscription(expires_at=PERIOD_END)
    assert modules.reminders.sweep(PERIOD_END - timedelta(days=1)) == {
        "scanned": 1, "notified": 1, "emailed": 0, "skipped": 0,
    }
    plan_db.mail.assert_not_called()
    assert plan_db.tables["PlanReminder"].rows[0].email_sent is False
    assert len(plan_db.tables["Notification"].rows) == 1


def test_email_failure_keeps_the_notification_and_the_idempotency_record(
    modules, plan_db, reminder_world, caplog
):
    plan_db.mail.side_effect = modules.email_sender.EmailDeliveryError("delivery_failed")
    with caplog.at_level(logging.WARNING, logger=modules.reminders.__name__):
        assert modules.reminders.sweep(PERIOD_END - timedelta(days=7)) == {
            "scanned": 1, "notified": 1, "emailed": 0, "skipped": 0,
        }
    record, = plan_db.tables["PlanReminder"].rows
    assert record.stage == "D7" and record.email_sent is False
    assert len(plan_db.tables["Notification"].rows) == 1
    # 日志只留租户与节点：不能出现收件人地址、SMTP 凭据或厂商诊断
    text = "\n".join(entry.getMessage() for entry in caplog.records)
    assert "owner@example.com" not in text and "delivery_failed" not in text
    assert "synthetic-password" not in text and "smtp" not in text.lower()
    # 幂等记录已落库：邮件失败不会导致下一次 sweep 重发站内通知
    assert modules.reminders.sweep(PERIOD_END - timedelta(days=7))["notified"] == 0
    assert len(plan_db.tables["Notification"].rows) == 1


def test_concurrent_instances_rely_on_the_unique_constraint_not_memory(
    modules, plan_db, reminder_world, monkeypatch
):
    plan_db.store(modules.models.PlanReminder(
        tenant_id=PERSONAL_TENANT_ID, period_end=PERIOD_END, stage="D7", email_sent=True,
    ))
    # 另一实例已写 D7，本实例的「发送前查询」恰好没看到 → 只剩唯一约束兜底
    monkeypatch.setattr(modules.reminders, "_already_sent", Mock(return_value=False))
    assert modules.reminders.sweep(PERIOD_END - timedelta(days=7)) == {
        "scanned": 1, "notified": 0, "emailed": 0, "skipped": 1,
    }
    assert plan_db.session.rollbacks == 1
    assert len(plan_db.tables["PlanReminder"].rows) == 1
    assert plan_db.tables["Notification"].rows == []
    plan_db.mail.assert_not_called()


def test_one_failing_tenant_never_stops_the_sweep(modules, plan_db, reminder_world, monkeypatch):
    other = plan_db.user(user_id=102, email="second@example.com")
    plan_db.tenant(12, owner_user_id=other.id)
    plan_db.subscription(tenant_id=12, expires_at=PERIOD_END)
    original = modules.reminders.recipient_for

    def flaky(tenant_id):
        if tenant_id == PERSONAL_TENANT_ID:
            raise RuntimeError("synthetic-recipient-failure")
        return original(tenant_id)

    monkeypatch.setattr(modules.reminders, "recipient_for", flaky)
    assert modules.reminders.sweep(PERIOD_END - timedelta(days=3)) == {
        "scanned": 2, "notified": 1, "emailed": 1, "skipped": 1,
    }
    assert [row.tenant_id for row in plan_db.tables["PlanReminder"].rows] == [12]


@pytest.mark.parametrize(
    "language, stage, days_left",
    [("en", "D3", 3), ("th", "D0", 0), ("en", "EXPIRED", -1), ("th", "EXPIRED", -4)],
)
def test_plan_reminder_email_is_bilingual_multipart_and_never_invents_links(
    app, modules, language, stage, days_left
):
    app.config["APP_BASE_URL"] = ""
    with app.app_context():
        message = modules.email_sender.plan_reminder_message(
            "sender@example.com", "owner@example.com", plan_name="Kinder",
            expires_on="2026-11-20", days_left=days_left, stage=stage, language=language,
        )
    assert message.get_content_type() == "multipart/alternative"
    plain = message.get_body(preferencelist=("plain",)).get_content()
    html = message.get_body(preferencelist=("html",)).get_content()
    for text in (plain, html):
        assert "Kinder" in text and "2026-11-20" in text
        # 未配置 APP_BASE_URL 时绝不编造链接
        assert "http://" not in text and "https://" not in text
    assert "#16866a" in html  # 与验证码邮件同一视觉风格
    assert message["To"] == "owner@example.com"
    thai = "แพ็กเกจ" in plain
    assert thai is (language == "th")


def test_plan_reminder_email_links_only_to_the_configured_base_url(app, modules):
    app.config["APP_BASE_URL"] = "https://app.example.com"
    with app.app_context():
        message = modules.email_sender.plan_reminder_message(
            "sender@example.com", "owner@example.com", plan_name="Starter",
            expires_on="2026-11-20", days_left=1, stage="D1", language="en",
        )
    html = message.get_body(preferencelist=("html",)).get_content()
    plain = message.get_body(preferencelist=("plain",)).get_content()
    assert 'href="https://app.example.com"' in html and "https://app.example.com" in plain


@pytest.mark.parametrize(
    "overrides",
    [{"stage": "D5"}, {"stage": ""}, {"plan_name": " "}, {"expires_on": ""}],
)
def test_plan_reminder_message_rejects_unknown_stages_and_empty_content(app, modules, overrides):
    values = dict(
        plan_name="Kinder", expires_on="2026-11-20", days_left=3, stage="D3", language="en",
    )
    values.update(overrides)
    with app.app_context():
        with pytest.raises(ValueError):
            modules.email_sender.plan_reminder_message(
                "sender@example.com", "owner@example.com", **values
            )


# ---------- 站内通知已读（首页铃铛） ----------


@pytest.mark.parametrize("ids, updated", [(None, 2), ([], 2), ("explicit", 1)])
def test_notifications_read_marks_all_or_only_the_given_ids(
    client, modules, plan_db, monkeypatch, ids, updated
):
    user = plan_db.user()
    other = plan_db.user(user_id=102)
    first = plan_db.notification(user.id, "PLAN_EXPIRING")
    second = plan_db.notification(user.id, "PLAN_EXPIRED", created_at=PLAN_NOW + timedelta(hours=1))
    foreign = plan_db.notification(other.id, "PLAN_EXPIRED")
    monkeypatch.setattr(modules.me, "current_user", Mock(return_value=user))
    body = {} if ids is None else {"ids": [first.id] if ids == "explicit" else ids}
    response = client.post("/api/v1/me/notifications/read", json=body)
    assert response.status_code == 200
    assert response.get_json()["data"] == {"updated": updated, "unread_count": 2 - updated}
    assert first.read_at is not None
    assert (second.read_at is None) is (ids == "explicit")
    assert foreign.read_at is None  # 只影响本人通知
    assert plan_db.session.commits == 1


@pytest.mark.parametrize("ids", ["all", 7, [True], [1, "2"], [None], {"1": True}, [1, 2.0]])
def test_notifications_read_rejects_invalid_ids_without_committing(
    client, modules, plan_db, monkeypatch, ids
):
    user = plan_db.user()
    row = plan_db.notification(user.id)
    monkeypatch.setattr(modules.me, "current_user", Mock(return_value=user))
    response = client.post("/api/v1/me/notifications/read", json={"ids": ids})
    _assert_field_error(response, "ids", "error.invalid_argument")
    assert row.read_at is None and plan_db.session.commits == 0


def test_notifications_list_feeds_the_home_bell_with_unread_count(
    client, modules, plan_db, monkeypatch
):
    user = plan_db.user()
    plan_db.notification(user.id, "PLAN_EXPIRING", created_at=PLAN_NOW)
    newest = plan_db.notification(
        user.id, "PLAN_EXPIRED", created_at=PLAN_NOW + timedelta(hours=1),
    )
    plan_db.notification(user.id, "MEMBERSHIP_ACTIVE", created_at=PLAN_NOW - timedelta(hours=1),
                         read_at=PLAN_NOW)
    # 非账户变动类（历史 OCR_DONE / INFO）不进列表也不计未读
    plan_db.notification(user.id, "OCR_DONE", created_at=PLAN_NOW + timedelta(hours=2))
    plan_db.notification(user.id, "INFO", created_at=PLAN_NOW + timedelta(hours=3))
    plan_db.notification(plan_db.user(user_id=102).id, "PLAN_EXPIRED")
    monkeypatch.setattr(modules.me, "current_user", Mock(return_value=user))
    response = client.get("/api/v1/me/notifications")
    assert response.status_code == 200
    payload = response.get_json()["data"]
    assert payload["unread_count"] == 2
    assert [item["id"] for item in payload["items"]][0] == newest.id
    assert [item["type"] for item in payload["items"]] == [
        "PLAN_EXPIRED", "PLAN_EXPIRING", "MEMBERSHIP_ACTIVE",
    ]
    assert [item["read"] for item in payload["items"]] == [False, False, True]


@pytest.fixture
def result_store(modules, fake_db, monkeypatch):
    user = _user(modules)
    job = modules.models.OcrJob(
        id="synthetic-job", created_by_user_id=user.id, tenant_id=PERSONAL_TENANT_ID,
        status="SUCCEEDED", review_status="UNREVIEWED", completed_at=None,
        page_count=1, table_count=0, field_count=1, missing_pages=[],
    )
    version = modules.models.ResultVersion(
        id="synthetic-version", job_id=job.id, version=1, is_current=True,
        structured={"fields": {"name": "original"}, "tables": []},
    )
    pages = []
    monkeypatch.setattr(modules.results, "current_user", Mock(return_value=user))
    monkeypatch.setattr(modules.results, "_get_job_for_user", Mock(return_value=job))
    monkeypatch.setattr(modules.results, "_current_version", Mock(return_value=version))
    monkeypatch.setattr(modules.results, "audit", Mock())
    # 通用结果路径：模板映射协作点替换为本地桩（模板结果由 test_template_routes.py 覆盖）
    monkeypatch.setattr(modules.results, "_lock_job", Mock(side_effect=lambda j: j))
    monkeypatch.setattr(modules.results, "_template_groups", Mock(return_value=None))
    monkeypatch.setattr(modules.results, "_template_extras", Mock(return_value={}))
    monkeypatch.setattr(modules.results, "_match_feedback", Mock())
    monkeypatch.setattr(
        modules.results, "_next_version_no", Mock(side_effect=lambda job_id: version.version + 1)
    )
    # All PageResult queries stay local; new versions/pages remain real mapped objects.
    query = Mock(name="synthetic_page_results")
    query.filter_by.return_value = query
    query.order_by.return_value = query
    query.all.side_effect = lambda: pages
    page_model = Mock(wraps=modules.models.PageResult)
    page_model.query = query
    page_model.page_number = modules.models.PageResult.page_number
    monkeypatch.setattr(modules.results, "PageResult", page_model)

    def flush():
        for entry in fake_db.session.add.call_args_list:
            row = entry.args[0]
            if isinstance(row, modules.models.ResultVersion) and row.id is None:
                row.id = "synthetic-edited-version"

    fake_db.session.flush.side_effect = flush
    return SimpleNamespace(user=user, job=job, version=version, pages=pages, query=query)


def _legacy_page(modules, store):
    store.version.structured = None
    page = modules.models.PageResult(
        id="synthetic-page", result_version_id=store.version.id, page_number=1, text="original",
        fields=[], tables=[{"table_id": "t1", "row_count": 1, "column_count": 1, "cells": [
            {"row_index": 0, "col_index": 0, "column_index": 0, "raw_text": "original",
             "current_text": "original", "review_status": "UNREVIEWED"},
        ]}],
    )
    store.pages.append(page)
    return page


@pytest.mark.parametrize("identity", ["guest", "unregistered", "guest_registered"])
@pytest.mark.parametrize("change", ["none", "structured", "legacy"])
@pytest.mark.parametrize("review_status", ["UNREVIEWED", "CONFIRMED"])
def test_continue_rejects_unregistered_before_any_version_or_state_write(
    client, modules, fake_db, result_store, identity, change, review_status
):
    store = result_store
    if identity.startswith("guest"):
        store.user.line_provider = "guest"
    if identity == "guest_registered":
        store.user.registered_at = FIXED_NOW
    store.job.review_status = review_status
    body = {"expected_version": 1, "confirm": True}
    if change == "structured":
        body["structured"] = {"fields": {"name": "changed"}, "tables": []}
    elif change == "legacy":
        _legacy_page(modules, store)
        body["edits"] = [{"page_number": 1, "table_id": "t1", "row_index": 0,
                          "column_index": 0, "current_text": "changed"}]
    before_job, before_version = dict(vars(store.job)), dict(vars(store.version))
    page_tables = copy.deepcopy([page.tables for page in store.pages])
    response = client.patch(f"/api/v1/ocr/jobs/{store.job.id}/results", json=body)
    if identity.startswith("guest"):
        _assert_error(response, 401, "AUTH_REQUIRED", "auth.login_required")
    else:
        _assert_error(response, 403, "PERMISSION_DENIED", "registration.required")
    assert vars(store.job) == before_job and vars(store.version) == before_version
    assert [page.tables for page in store.pages] == page_tables
    assert not fake_db.session.mock_calls
    store.query.filter_by.assert_not_called()
    modules.results.audit.assert_not_called()


@pytest.mark.parametrize("identity", ["guest", "unregistered", "registered"])
@pytest.mark.parametrize("change", ["none", "structured", "legacy"])
def test_draft_saves_remain_available_without_registration_or_subscription(
    client, modules, fake_db, result_store, identity, change
):
    store = result_store
    if identity == "guest":
        store.user.line_provider = "guest"
    if identity == "registered":
        store.user.registered_at = FIXED_NOW
    body = {"expected_version": 1, "confirm": False}
    if change == "structured":
        body["structured"] = {"fields": {"name": "changed"}, "tables": []}
    elif change == "legacy":
        _legacy_page(modules, store)
        body["edits"] = [{"page_number": 1, "table_id": "t1", "row_index": 0,
                          "column_index": 0, "current_text": "changed"}]
    response = client.patch(f"/api/v1/ocr/jobs/{store.job.id}/results", json=body)
    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["version"] == (1 if change == "none" else 2)
    assert store.version.is_current is (change == "none")
    assert store.job.review_status == ("UNREVIEWED" if change == "none" else "EDITED")
    assert store.job.completed_at is None
    if change == "structured":
        assert data["structured"] == body["structured"]
    fake_db.session.commit.assert_called_once_with()
    fake_db.session.get.assert_not_called()
    modules.results.audit.assert_called_once()


@pytest.mark.parametrize("review_status", ["UNREVIEWED", "EDITED", "CONFIRMED"])
@pytest.mark.parametrize("tenant_kind", ["personal", "enterprise"])
@pytest.mark.parametrize("legacy", [False, True])
def test_registered_explicit_continue_completes_including_legacy_verified(
    client, modules, fake_db, result_store, review_status, tenant_kind, legacy
):
    store = result_store
    store.user.registered_at = FIXED_NOW
    store.job.review_status = review_status
    # 归属只剩 tenant_id：个人/企业租户走同一条确认流程，不再区分 workspace_type
    store.job.tenant_id = (
        ENTERPRISE_TENANT_ID if tenant_kind == "enterprise" else PERSONAL_TENANT_ID
    )
    page = _legacy_page(modules, store) if legacy else None
    response = client.patch(
        f"/api/v1/ocr/jobs/{store.job.id}/results", json={"expected_version": 1, "confirm": True},
    )
    assert response.status_code == 200
    assert store.job.review_status == "CONFIRMED" and store.job.completed_at is not None
    assert store.job.stage() == "COMPLETED" and response.get_json()["data"]["version"] == 1
    if page:
        cell = page.tables[0]["cells"][0]
        assert cell["review_status"] == "CONFIRMED" and cell["raw_text"] == "original"
    completed_at = store.job.completed_at
    assert client.patch(
        f"/api/v1/ocr/jobs/{store.job.id}/results", json={"expected_version": 1, "confirm": True},
    ).status_code == 200
    assert store.job.completed_at == completed_at
    assert fake_db.session.commit.call_count == 2
    fake_db.session.add.assert_not_called()
    fake_db.session.get.assert_not_called()  # No subscription gate, including enterprise.


def test_registration_no_longer_gates_the_default_plan(
    client, modules, fake_db, member, email_store
):
    member.registered_at = None
    email_store.seed()
    response = client.post("/api/v1/me/registration", json=_registration_body())
    assert response.status_code == 200 and member.registered_at == FIXED_NOW
    # 默认开通改成「建租户即 Kinder 一个月」，注册流程既不建申请也不碰订阅
    assert not hasattr(modules.me, "subscriptions")
    assert not hasattr(modules.me, "Subscription")
    fake_db.session.add.assert_not_called()
    fake_db.session.commit.assert_called_once_with()


@pytest.mark.parametrize("revoked", [False, True])
def test_logout_revokes_current_session_and_deletes_same_path_cookie(
    client, modules, fake_db, monkeypatch, revoked
):
    session = modules.models.Session(user_id=101, revoked_at=FIXED_NOW if revoked else None)
    monkeypatch.setattr(modules.routes, "current_session", Mock(return_value=session))
    response = client.post("/api/v1/auth/logout", json={})
    assert response.status_code == 200
    assert response.get_json() == {"code": "OK", "data": {"logged_out": True}}
    assert session.revoked_at is not None
    cookie = response.headers["Set-Cookie"]
    assert cookie.startswith("saiflow_session=;") and "Max-Age=0" in cookie and "Path=/api" in cookie
    assert client.get_cookie("saiflow_session", path="/api") is None
    assert fake_db.session.commit.call_count == int(not revoked)
    fake_db.session.delete.assert_not_called()
    fake_db.session.add.assert_not_called()


@pytest.mark.parametrize(
    "instant, month_start",
    [(datetime(2026, 10, 31, 16, 59, tzinfo=timezone.utc), datetime(2026, 9, 30, 17)),
     (datetime(2026, 10, 31, 17, tzinfo=timezone.utc), datetime(2026, 10, 31, 17)),
     (datetime(2026, 12, 31, 17, tzinfo=timezone.utc), datetime(2026, 12, 31, 17))],
)
def test_monthly_quota_keeps_thai_calendar_month_boundary(modules, monkeypatch, instant, month_start):
    clock = Mock()
    clock.now.side_effect = lambda tz: instant.astimezone(tz)
    monkeypatch.setattr(modules.quota, "datetime", clock)
    assert modules.quota._month_start_utc() == month_start
    clock.now.assert_called_once_with(modules.subscriptions.BILLING_TZ)


@pytest.mark.parametrize("tenant_kind", ["personal", "enterprise"])
def test_monthly_pages_keep_tenant_scope_and_exclude_failed_cancelled(
    modules, fake_db, monkeypatch, tenant_kind
):
    start = datetime(2026, 9, 30, 17)
    tenant_id = ENTERPRISE_TENANT_ID if tenant_kind == "enterprise" else PERSONAL_TENANT_ID
    monkeypatch.setattr(modules.quota, "_month_start_utc", Mock(return_value=start))
    query = Mock()
    query.filter.return_value = query
    query.scalar.return_value = 125
    fake_db.session.query.return_value = query
    assert modules.quota.pages_used(tenant_id) == 125
    criteria = {
        criterion.left.key: criterion.right.value
        for entry in query.filter.call_args_list for criterion in entry.args
    }
    criteria["status"] = tuple(criteria["status"])
    # 计量口径收敛到单一 tenant_id：企业租户天然汇总成员，不再按 created_by_user_id 兜底
    assert criteria == {
        "created_at": start, "status": ("FAILED", "CANCELLED"), "tenant_id": tenant_id,
    }
    fake_db.session.commit.assert_not_called()


@pytest.mark.parametrize("change", ["structured", "legacy"])
def test_registered_continue_can_save_content_and_complete_together(
    client, modules, fake_db, result_store, change
):
    store = result_store
    store.user.registered_at = FIXED_NOW
    body = {"expected_version": 1, "confirm": True}
    if change == "structured":
        body["structured"] = {"fields": {"name": "changed"}, "tables": []}
    else:
        _legacy_page(modules, store)
        body["edits"] = [{"page_number": 1, "table_id": "t1", "row_index": 0,
                          "column_index": 0, "current_text": "changed"}]
    response = client.patch(f"/api/v1/ocr/jobs/{store.job.id}/results", json=body)
    assert response.status_code == 200 and response.get_json()["data"]["version"] == 2
    assert store.version.is_current is False
    assert store.job.review_status == "CONFIRMED" and store.job.completed_at is not None
    assert store.job.stage() == "COMPLETED"
    fake_db.session.commit.assert_called_once_with()
    fake_db.session.get.assert_not_called()
    modules.results.audit.assert_called_once()


@pytest.mark.parametrize(
    "identity, confirm",
    [("guest", False), ("unregistered", False), ("registered", False), ("registered", True)],
)
@pytest.mark.parametrize("name, value", [("kkk", 123), ("tax_id", "00123"), ("หมายเหตุ", "ทดสอบ")])
def test_added_fields_survive_save_reload_and_xlsx_without_overwriting_history(
    client, modules, fake_db, result_store, monkeypatch, identity, confirm, name, value,
):
    """FR-VERIFY-015: actual route/serializer/export builder, entirely synthetic storage."""
    import io
    from openpyxl import load_workbook

    store = result_store
    if identity == "guest":
        store.user.line_provider = "guest"
    if identity == "registered":
        store.user.registered_at = FIXED_NOW
    original = {
        "document_information": {"remarks": "original"},
        "seller": {"tel": ["065-205-8258", "065-205-8259"]},
        "items": [{"quantity": 3, "amount": 29650}],
    }
    store.version.structured = copy.deepcopy(original)
    edited = copy.deepcopy(original)
    edited["document_information"][name] = value
    body = {"expected_version": 1, "confirm": confirm, "structured": edited}
    response = client.patch(f"/api/v1/ocr/jobs/{store.job.id}/results", json=body)
    assert response.status_code == 200
    assert response.get_json()["data"]["structured"] == edited
    assert response.get_json()["data"]["version"] == 2
    assert store.version.structured == original and store.version.is_current is False
    assert (store.job.completed_at is not None) is confirm

    saved = next(
        entry.args[0] for entry in fake_db.session.add.call_args_list
        if isinstance(entry.args[0], modules.models.ResultVersion)
    )
    assert saved.structured == edited and saved.is_current is True
    assert saved.structured["document_information"][name] == value
    modules.results._current_version.return_value = saved
    reloaded = client.get(f"/api/v1/ocr/jobs/{store.job.id}/results")
    assert reloaded.status_code == 200
    assert reloaded.get_json()["data"]["structured"] == edited
    fake_db.session.commit.assert_called_once_with()

    exports = _load_module("field_preservation_exports", "routes/exports.py")
    output = io.BytesIO()
    exports._build_xlsx_structured(saved.structured, output, [], language="en")
    output.seek(0)
    workbook = load_workbook(output, read_only=True)
    try:
        cells = list(workbook.active.iter_rows(values_only=True))
        expected = exports._format_cell(value, name)
        assert any(row[:2] == (exports._display_name(name), expected) for row in cells)
        assert any(row[:2] == (exports._display_name("remarks"), "original") for row in cells)
    finally:
        workbook.close()


# ---------- 租户归属（PRD §4.1：tenant_id 是唯一归属表达） ----------


def _model_proxy(model, rows):
    """用内存行表伪造 Model.query：隔离测试里不允许存在真实 DB 会话。

    必须先用 setattr 覆盖 query，再碰 proxy 的任何属性——Mock(wraps=...) 读属性时
    会去取被包装类的同名属性，而 Model.query 在没有 db.init_app 的进程里会直接报错。
    """
    proxy = Mock(name=model.__name__, wraps=model)
    query = Mock(name=f"{model.__name__}.query")

    def filter_by(**criteria):
        scoped = Mock(name=f"{model.__name__}.filtered")

        def matched():
            return [
                row for row in rows()
                if all(getattr(row, key, None) == value for key, value in criteria.items())
            ]

        scoped.order_by.return_value = scoped
        scoped.first.side_effect = lambda: next(iter(matched()), None)
        scoped.all.side_effect = matched
        return scoped

    query.filter_by.side_effect = filter_by
    proxy.query = query
    # 真实列对象要保留：workspace 会用 Membership.created_at 排序
    for name in model.__mapper__.columns.keys():
        setattr(proxy, name, getattr(model, name))
    return proxy


@pytest.fixture
def tenant_store(modules, fake_db, monkeypatch):
    """租户/成员/企业的内存替身，让 workspace 的真实解析逻辑可以无库运行。"""
    tenants, memberships, enterprises = {}, [], []
    next_id = [500]

    tenant_model = _model_proxy(modules.models.Tenant, lambda: list(tenants.values()))
    monkeypatch.setattr(modules.workspace, "Tenant", tenant_model)
    monkeypatch.setattr(
        modules.workspace, "Membership",
        _model_proxy(modules.models.Membership, lambda: list(memberships)),
    )
    monkeypatch.setattr(
        modules.workspace, "Enterprise",
        _model_proxy(modules.models.Enterprise, lambda: list(enterprises)),
    )

    def add(row):
        if isinstance(row, modules.models.Tenant):
            if row.id is None:
                next_id[0] += 1
                row.id = next_id[0]
            tenants[row.id] = row

    fake_db.session.add.side_effect = add
    # 租户按主键取；其它模型（如 _summary 取 File）一律不命中，返回 None
    fake_db.session.get.side_effect = lambda model, pk: (
        tenants.get(pk) if model is tenant_model else None
    )

    def put_tenant(tenant):
        tenants[tenant.id] = tenant
        return tenant

    def put_membership(tenant_id, user_id, status="ACTIVE", role="MEMBER"):
        row = modules.models.Membership(
            tenant_id=tenant_id, user_id=user_id, status=status, role=role, created_at=FIXED_NOW,
        )
        memberships.append(row)
        return row

    def put_enterprise(tenant_id, status="VERIFIED", legal_name="Synthetic Co"):
        row = modules.models.Enterprise(
            tenant_id=tenant_id, status=status, legal_name=legal_name, code="ent-synthetic",
        )
        enterprises.append(row)
        return row

    return SimpleNamespace(
        tenants=tenants, memberships=memberships, enterprises=enterprises,
        tenant=put_tenant, membership=put_membership, enterprise=put_enterprise,
    )


def test_personal_tenant_is_one_to_one_by_schema(modules):
    # 个人租户与用户 1:1 靠唯一约束兜底；企业租户 owner_user_id 为 NULL 不受影响
    constraints = {
        c.name: tuple(col.name for col in c.columns)
        for c in modules.models.Tenant.__table__.constraints
        if isinstance(c, UniqueConstraint)
    }
    assert constraints == {"uq_tenants_owner_user": ("owner_user_id",)}
    owner = modules.models.Tenant.__table__.c.owner_user_id
    assert owner.nullable is True
    assert {fk.target_fullname for fk in owner.foreign_keys} == {"users.id"}
    assert modules.models.Tenant.__table__.c.tenant_type.nullable is False
    # 归属列必须 NOT NULL，避免出现「没有租户的业务行」
    for model in (modules.models.File, modules.models.OcrJob, modules.models.Subscription,
                  modules.models.PlanReminder, modules.models.Membership,
                  modules.models.Invitation):
        assert model.__table__.c.tenant_id.nullable is False
    assert modules.models.Application.__table__.c.target_tenant_id.nullable is False
    assert modules.models.Enterprise.__table__.c.tenant_id.unique is True
    # 赠送次数流水已删除：只剩 OCR_PAGE 月页计量
    assert not hasattr(modules.models, "QuotaLedger")
    # 一租户一行订阅 + 到期提醒按 (租户, 本期到期时间, 节点) 幂等
    assert modules.models.Subscription.__table__.c.tenant_id.unique is True
    assert modules.models.Subscription.__table__.c.expires_at.nullable is False
    reminder_unique = {
        c.name: tuple(col.name for col in c.columns)
        for c in modules.models.PlanReminder.__table__.constraints
        if isinstance(c, UniqueConstraint)
    }
    assert reminder_unique == {"uq_plan_reminder_stage": ("tenant_id", "period_end", "stage")}


@pytest.mark.parametrize("commit", [False, True])
def test_personal_tenant_creation_is_idempotent(modules, fake_db, tenant_store, commit):
    user = _user(modules)
    tenant = modules.workspace.ensure_personal_tenant(user, commit=commit)
    assert tenant.tenant_type == "PERSONAL" and tenant.owner_user_id == user.id
    assert tenant.status == "ACTIVE" and tenant.display_name == "Synthetic User"
    assert tenant.id is not None
    fake_db.session.add.assert_called_once_with(tenant)
    fake_db.session.flush.assert_called_once_with()
    # 默认不提交：_upsert_line_user 的 SELECT ... FOR UPDATE 行锁不能被提前释放（FR-SYS-014）
    assert fake_db.session.commit.call_count == int(commit)
    assert modules.workspace.ensure_personal_tenant(user) is tenant
    fake_db.session.add.assert_called_once_with(tenant)
    # 另一个用户不会复用别人的个人租户
    other = modules.workspace.ensure_personal_tenant(_user(modules, sub="U-other", user_id=102))
    assert other is not tenant and other.owner_user_id == 102
    assert fake_db.session.add.call_count == 2


def test_guest_upload_and_job_carry_tenant_id(client, modules, fake_db, tenant_store, monkeypatch):
    # 游客同样是个人租户：试用期产生的文件/任务也必须有 tenant_id 归属
    guest = _user(modules, sub="G-synthetic-guest", provider="guest", user_id=301)
    monkeypatch.setattr(modules.files, "current_user", Mock(return_value=guest))
    monkeypatch.setattr(modules.ocr, "current_user", Mock(return_value=guest))
    monkeypatch.setattr(modules.ocr, "audit", Mock())
    monkeypatch.setattr(modules.ocr, "quota", Mock())

    response = client.post(
        "/api/v1/uploads", json={"file_name": "synthetic.pdf", "purpose": "OCR_TASK"},
    )
    assert response.status_code == 201
    uploaded = fake_db.session.add.call_args.args[0]
    assert isinstance(uploaded, modules.models.File)
    tenant_id = uploaded.tenant_id
    assert tenant_id is not None and tenant_store.tenants[tenant_id].tenant_type == "PERSONAL"
    assert tenant_store.tenants[tenant_id].owner_user_id == guest.id
    assert response.get_json()["data"]["file"]["tenant_id"] == tenant_id

    uploaded.id = "synthetic-file"
    uploaded.status = "READY"
    monkeypatch.setattr(modules.ocr, "get_file_for_user", Mock(return_value=uploaded))
    response = client.post("/api/v1/ocr/jobs", json={"file_id": uploaded.id})
    assert response.status_code == 201
    job = fake_db.session.add.call_args.args[0]
    assert isinstance(job, modules.models.OcrJob)
    assert job.tenant_id == tenant_id and job.created_by_user_id == guest.id
    assert response.get_json()["data"]["tenant_id"] == tenant_id
    modules.ocr.quota.check_and_consume.assert_called_once_with(job)


@pytest.mark.parametrize(
    "case, status, code",
    [
        ("missing", 400, "INVALID_ARGUMENT"),
        ("wrong_type", 400, "INVALID_ARGUMENT"),
        ("other_personal", 403, "PERMISSION_DENIED"),
        ("disabled_personal", 403, "ACCOUNT_DISABLED"),
        ("no_membership", 403, "PERMISSION_DENIED"),
        ("inactive_membership", 403, "ENTERPRISE_ACCESS_REVOKED"),
        ("unverified_enterprise", 403, "ENTERPRISE_ACCESS_REVOKED"),
        ("disabled_tenant", 403, "ENTERPRISE_ACCESS_REVOKED"),
        ("ok", None, None),
    ],
)
def test_resolve_tenant_rejects_every_unauthorized_tenant(
    modules, fake_db, tenant_store, case, status, code
):
    user = _user(modules)
    if case == "other_personal":
        tenant_store.tenant(_tenant(modules, 900, owner_user_id=999))
    if case == "disabled_personal":
        tenant_store.tenant(_tenant(modules, 900, owner_user_id=user.id, status="DISABLED"))
    if case == "wrong_type":
        tenant_store.tenant(_tenant(modules, 900, tenant_type="SYSTEM"))
    if case in ("no_membership", "inactive_membership", "unverified_enterprise",
                "disabled_tenant", "ok"):
        tenant_store.tenant(_tenant(
            modules, 900, "ENTERPRISE",
            status="DISABLED" if case == "disabled_tenant" else "ACTIVE",
        ))
        tenant_store.enterprise(
            900, status="PENDING" if case == "unverified_enterprise" else "VERIFIED",
        )
        if case != "no_membership":
            tenant_store.membership(
                900, user.id, status="REMOVED" if case == "inactive_membership" else "ACTIVE",
            )

    if status is None:
        assert modules.workspace.resolve_tenant(user, 900).id == 900
        return
    with pytest.raises(modules.errors.ApiError) as excinfo:
        modules.workspace.resolve_tenant(user, 900)
    assert (excinfo.value.http_status, excinfo.value.code) == (status, code)
    if case == "missing":
        assert excinfo.value.message_key == "error.invalid_workspace"
    fake_db.session.commit.assert_not_called()


def test_accessible_tenant_ids_keep_cross_tenant_isolation(modules, tenant_store):
    user = _user(modules)
    personal = modules.workspace.ensure_personal_tenant(user)
    tenant_store.tenant(_tenant(modules, 901, "ENTERPRISE"))  # ACTIVE 成员 → 可见
    tenant_store.tenant(_tenant(modules, 902, "ENTERPRISE"))  # 成员已移除 → 不可见
    tenant_store.tenant(_tenant(modules, 903, "ENTERPRISE", status="DISABLED"))  # 租户停用
    tenant_store.tenant(_tenant(modules, 904, "ENTERPRISE"))  # 别人的企业
    tenant_store.tenant(_tenant(modules, 905, owner_user_id=999))  # 别人的个人租户
    tenant_store.membership(901, user.id)
    tenant_store.membership(902, user.id, status="REMOVED")
    tenant_store.membership(903, user.id)
    tenant_store.membership(904, 999)
    assert modules.workspace.accessible_tenant_ids(user) == [personal.id, 901]
    # 未过审企业仍可读历史（与改造前 _active_enterprise_ids 等价），但 list_tenants 不列出
    tenant_store.enterprise(901, status="PENDING")
    assert [t["tenant_id"] for t in modules.workspace.list_tenants(user)] == [personal.id]


def test_guest_claim_migrates_rows_and_drops_guest_tenant(modules, fake_db, monkeypatch):
    guest = _user(modules, sub="G-synthetic-guest", provider="guest", user_id=301)
    guest.avatar_path = "avatars/synthetic-guest.png"
    user = _user(modules)
    guest_tenant = _tenant(modules, 777, owner_user_id=guest.id, name="Guest")
    tenant = _tenant(modules, PERSONAL_TENANT_ID, owner_user_id=user.id)

    # _claim_guest_data 里是函数内 import models，所以替身要挂在 models 模块属性上
    audit_model = modules.models.AuditEvent
    proxies = {}
    for name in (
        "Application", "AuditEvent", "DataRequest", "EmailVerificationCode", "Export",
        "File", "Invitation", "Membership", "Notification", "OcrJob", "PlanReminder",
        "ResultVersion", "Subscription",
    ):
        model = getattr(modules.models, name)
        proxy = Mock(name=name, wraps=model)
        query = Mock(name=f"{name}.query")
        query.filter.return_value = query
        query.filter_by.return_value = query
        query.update.return_value = 0
        query.delete.return_value = 0
        proxy.query = query
        for column in model.__mapper__.columns.keys():
            setattr(proxy, column, getattr(model, column))
        monkeypatch.setattr(modules.models, name, proxy)
        proxies[name] = proxy

    session_query = Mock(name="Session.query")
    session_query.filter_by.return_value = session_query
    session_query.delete.return_value = 0
    session_proxy = Mock(name="Session", wraps=modules.models.Session)
    session_proxy.query = session_query
    monkeypatch.setattr(modules.routes, "Session", session_proxy)
    tenant_query = Mock(name="Tenant.query")
    tenant_query.filter_by.return_value = tenant_query
    tenant_query.first.return_value = guest_tenant
    tenant_proxy = Mock(name="Tenant", wraps=modules.models.Tenant)
    tenant_proxy.query = tenant_query
    monkeypatch.setattr(modules.routes, "Tenant", tenant_proxy)
    # Membership 用「我已加入的租户」子查询去重，这里给真 select 才能走 in_()
    fake_db.session.query.side_effect = lambda *columns: select(*columns)

    assert modules.routes._claim_guest_data(guest, user, tenant) == guest.avatar_path

    tenant_query.filter_by.assert_called_once_with(owner_user_id=guest.id)
    moved = {
        name: [
            entry.args[0] for entry in proxies[name].query.update.call_args_list
        ]
        for name in ("File", "OcrJob", "Application")
    }
    # 业务行必须全部改挂到目标个人租户，否则删游客租户会撞 NOT NULL 外键
    assert {"tenant_id": tenant.id} in moved["File"]
    assert {"tenant_id": tenant.id} in moved["OcrJob"]
    assert {"target_tenant_id": tenant.id} in moved["Application"]
    for name in ("File", "OcrJob", "Application"):
        for entry in proxies[name].query.update.call_args_list:
            assert entry.kwargs == {"synchronize_session": False}
    # 游客试用订阅与其到期提醒随租户作废：正式账号按自己的周期重新开通一个月
    for name in ("Subscription", "PlanReminder"):
        assert proxies[name].query.filter_by.call_args_list == [call(tenant_id=guest_tenant.id)]
        assert proxies[name].query.delete.call_args_list == [call(synchronize_session=False)]
        assert proxies[name].query.update.call_args_list == []
        proxies[name].assert_not_called()  # 绝不给正式账号继承游客订阅行
    # tenants.owner_user_id → users.id：顺序反了会 FK 失败
    assert fake_db.session.delete.call_args_list == [call(guest_tenant), call(guest)]
    audit_event = fake_db.session.add.call_args.args[0]
    assert isinstance(audit_event, audit_model)
    assert audit_event.action == "guest.claim" and audit_event.detail["guest_deleted"] is True
    fake_db.session.commit.assert_not_called()  # 由 _finish_login 统一提交
