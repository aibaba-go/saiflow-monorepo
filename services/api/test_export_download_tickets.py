"""限时导出下载票据测试（FR-ENTRY-015 / AC-FR-ENTRY-015-02，NFR-SEC-002/003）。

Android LINE 内置浏览器把下载交给不带 Cookie 的系统下载器，前端改为先换 60 秒票据再在系统浏览器打开。
真实中间件 + 真实会话 + 路由模块逐个加载（不导入 app.py），内存 SQLite；
不连共享库、不访问网络，导出内容为合成数据。
"""
from __future__ import annotations

import importlib.util
import socket
import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from flask import Flask

from auth import create_session
from config import Config
from errors import ApiError, error_response
from extensions import db
from middleware import register_security
from models import AuditEvent, Export, File, OcrJob, ResultVersion, Session, Tenant, User

API_DIR = Path(__file__).resolve().parent
FILE_ID = "a" * 32
STRUCTURED = {"document": {"invoice_no": "000123", "total_amount": 1234.5}}


def _load_module(name, filename):
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
def routes():
    package = ModuleType("routes")
    package.__path__ = []
    with pytest.MonkeyPatch.context() as loader:
        loader.setitem(sys.modules, "routes", package)
        ocr = _load_module("routes.ocr", "routes/ocr.py")
        loader.setitem(sys.modules, "routes.ocr", ocr)
        exports = _load_module("routes.exports", "routes/exports.py")
        yield SimpleNamespace(ocr=ocr, exports=exports)


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("ticket tests must not open network connections")

    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)


@pytest.fixture()
def stored(routes, monkeypatch):
    saved: dict[str, bytes] = {}

    def put_bytes(category, name, data, mime):
        saved[f"{category}/{name}"] = data
        return f"{category}/{name}"

    monkeypatch.setattr(routes.exports.storage, "put_bytes", put_bytes)
    monkeypatch.setattr(routes.exports.storage, "exists", lambda path: path in saved)
    monkeypatch.setattr(routes.exports.storage, "get_bytes", lambda path: saved[path])
    return saved


@pytest.fixture()
def app(routes, stored):
    app = Flask(__name__)
    app.config.from_object(Config)
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite://", SQLALCHEMY_ENGINE_OPTIONS={},
        SECRET_KEY="synthetic-ticket-test-key", AUTH_DEV_MODE=False,
    )
    db.init_app(app)
    for bp in (routes.ocr.ocr_bp, routes.exports.exports_bp):
        app.register_blueprint(bp, url_prefix="/api/v1")
    register_security(app)

    @app.errorhandler(ApiError)
    def _api_error(err):
        return error_response(err)

    registered = datetime(2026, 10, 1)
    with app.app_context():
        db.create_all()
        db.session.add_all([
            User(id=1, line_provider="line", line_sub="synthetic-1", display_name="Synthetic A",
                 registered_at=registered, language="en"),
            User(id=2, line_provider="line", line_sub="synthetic-2", display_name="Synthetic B",
                 registered_at=registered),
        ])
        db.session.flush()
        db.session.add_all([
            Tenant(id=7, tenant_type="PERSONAL", owner_user_id=1, display_name="t7", status="ACTIVE"),
            Tenant(id=8, tenant_type="PERSONAL", owner_user_id=2, display_name="t8", status="ACTIVE"),
        ])
        db.session.flush()
        db.session.add(File(id=FILE_ID, tenant_id=7, created_by_user_id=1, uploader_user_id=1,
                            original_name="synthetic.pdf", storage_path="files/synthetic.pdf",
                            status="READY", page_count=1))
        job = OcrJob(tenant_id=7, created_by_user_id=1, file_id=FILE_ID, status="SUCCEEDED",
                     review_status="CONFIRMED", page_count=1)
        db.session.add(job)
        db.session.flush()
        db.session.add(ResultVersion(job_id=job.id, version=1, is_current=True, structured=STRUCTURED))
        db.session.commit()
        app.config["TEST_JOB_ID"] = job.id
        yield app
        db.session.remove()
        db.drop_all()


def _login(app, user_id: int):
    """真实会话：返回已带 Cookie 的客户端与 CSRF 头。"""
    client = app.test_client()
    with app.test_request_context():
        _, token, csrf = create_session(db.session.get(User, user_id))
        db.session.commit()
    client.set_cookie(Config.SESSION_COOKIE_NAME, token, path="/api")
    return client, {Config.CSRF_HEADER_NAME: csrf}


@pytest.fixture()
def owner(app):
    return _login(app, 1)


def _export(app, owner) -> str:
    client, csrf = owner
    resp = client.post(f"/api/v1/ocr/jobs/{app.config['TEST_JOB_ID']}/exports", json={"format": "XLSX"},
                       headers=csrf)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["data"]["id"]


def _ticket(owner, export_id: str):
    client, csrf = owner
    return client.post(f"/api/v1/exports/{export_id}/download-ticket", headers=csrf)


def _ticket_url(owner, export_id: str) -> str:
    resp = _ticket(owner, export_id)
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()["data"]
    assert data["url"].startswith("/api/v1/export-downloads/")
    issued = datetime.fromisoformat(data["expires_at"])
    assert timedelta(seconds=0) < issued - datetime.utcnow() <= timedelta(seconds=61)
    return data["url"]


def test_ticket_downloads_without_cookie_as_attachment(app, owner, stored):
    export_id = _export(app, owner)
    url = _ticket_url(owner, export_id)

    anonymous = app.test_client()  # 系统浏览器/下载器：没有会话 Cookie
    resp = anonymous.get(url)
    assert resp.status_code == 200
    assert resp.mimetype == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert resp.headers["Content-Disposition"].startswith("attachment;")
    assert ".xlsx" in resp.headers["Content-Disposition"]
    assert resp.headers["Cache-Control"] == "no-store"
    assert resp.headers["Referrer-Policy"] == "no-referrer"
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.data == stored[f"exports/{export_id}.xlsx"]
    assert "Set-Cookie" not in resp.headers  # 票据不签发会话

    # 下载器可能重复请求（HEAD / 二次 GET）：票据有效期内可重复取同一文件，不扩展到其他导出
    assert anonymous.head(url).status_code == 200
    assert anonymous.get(url).status_code == 200
    with app.app_context():
        events = AuditEvent.query.filter_by(object_id=export_id).all()
        actions = [e.action for e in events]
        assert "export.download_ticket" in actions
        downloads = [e for e in events if e.action == "export.download"]
        assert downloads and all(e.user_id == 1 and e.detail == {"via": "ticket"} for e in downloads)


def test_ticket_is_scoped_and_tamper_proof(app, owner):
    export_id = _export(app, owner)
    url = _ticket_url(owner, export_id)
    anonymous = app.test_client()
    prefix, sig = url.rsplit(".", 1)
    flipped = ("A" if sig[0] != "A" else "B") + sig[1:]
    other_export = "b" * 32
    for bad in (
        f"{prefix}.{flipped}",                           # 签名被改
        url.replace(export_id, other_export),            # 换导出 ID
        url.replace(f"{export_id}.1.", f"{export_id}.2.", 1),  # 换用户
        "/api/v1/export-downloads/not-a-ticket",          # 格式不符：中间件要求会话
    ):
        resp = anonymous.get(bad)
        assert resp.status_code in (401, 404), bad
        assert resp.status_code == 404 or bad.endswith("not-a-ticket")
    # 票据路径只读：写方法仍需会话
    assert anonymous.post(url).status_code == 401


def test_ticket_expires_after_ttl(app, owner, routes, monkeypatch):
    export_id = _export(app, owner)
    url = _ticket_url(owner, export_id)
    now = routes.exports.time.time()
    monkeypatch.setattr(routes.exports.time, "time", lambda: now + routes.exports.DOWNLOAD_TICKET_TTL_SECONDS + 1)
    assert app.test_client().get(url).status_code == 404


def test_ticket_rechecks_session_and_account(app, owner):
    export_id = _export(app, owner)
    url = _ticket_url(owner, export_id)
    with app.app_context():
        for session in Session.query.filter_by(user_id=1).all():
            session.revoked_at = datetime.utcnow()
        db.session.commit()
    assert app.test_client().get(url).status_code == 404  # 注销后票据随会话失效

    fresh = _login(app, 1)
    url = _ticket_url(fresh, export_id)
    with app.app_context():
        db.session.get(User, 1).status = "DISABLED"
        db.session.commit()
    assert app.test_client().get(url).status_code == 404


def test_ticket_rechecks_object_access_and_export_state(app, owner):
    export_id = _export(app, owner)
    stranger = _login(app, 2)
    assert _ticket(stranger, export_id).status_code == 404  # 跨用户不可换票据

    url = _ticket_url(owner, export_id)
    with app.app_context():
        db.session.get(Export, export_id).expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.session.commit()
    resp = app.test_client().get(url)
    assert resp.status_code == 409 and resp.get_json()["message_key"] == "export.expired"
    assert _ticket(owner, export_id).status_code == 409


def test_ticket_issue_requires_session_and_csrf(app, owner):
    export_id = _export(app, owner)
    client, _ = owner
    assert client.post(f"/api/v1/exports/{export_id}/download-ticket").status_code == 403
    assert app.test_client().post(f"/api/v1/exports/{export_id}/download-ticket").status_code == 401


def test_cookie_download_is_unchanged(app, owner, stored):
    export_id = _export(app, owner)
    client, _ = owner
    resp = client.get(f"/api/v1/exports/{export_id}/download")
    assert resp.status_code == 200 and resp.data == stored[f"exports/{export_id}.xlsx"]
    assert app.test_client().get(f"/api/v1/exports/{export_id}/download").status_code == 401


def test_default_secret_refuses_tickets_on_cloud_run(app, owner, monkeypatch):
    export_id = _export(app, owner)
    app.config["SECRET_KEY"] = "change-this-in-production"
    monkeypatch.setenv("K_SERVICE", "saiflow-api")
    resp = _ticket(owner, export_id)
    assert resp.status_code == 503 and resp.get_json()["code"] == "EXPORT_UNAVAILABLE"
