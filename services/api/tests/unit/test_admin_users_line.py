from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.sql.dml import Delete

from app.clock import utcnow
from app.errors import AppError
from app.models import User
from app.services import password_service
from app.services.session_service import Principal


def service(name):
    import importlib.util

    assert importlib.util.find_spec(f"app.services.{name}"), f"missing {name} feature"
    return __import__(f"app.services.{name}", fromlist=[name])


def database(user=None, scalar=None):
    result = Mock()
    result.scalar_one_or_none.return_value = scalar
    return SimpleNamespace(
        add=Mock(),
        flush=AsyncMock(),
        commit=AsyncMock(),
        rollback=AsyncMock(),
        get=AsyncMock(return_value=user),
        execute=AsyncMock(return_value=result),
        scalar=AsyncMock(return_value=None),
    )


@pytest.mark.parametrize(
    "field,value", [("email", "bad"), ("display_name", ""), ("phone", "abc"), ("password", "weak")]
)
async def test_admin_create_rejects_invalid_fields_before_insert(field, value):
    svc = service("admin_user_service")
    data = {
        "email": "ops@example.com",
        "display_name": "Ops",
        "phone": None,
        "password": "SafePass123",
    }
    data[field] = value
    db = database()
    with pytest.raises(AppError) as caught:
        await svc.create(db, 9, **data)
    assert caught.value.status == 400 and field in caught.value.fields
    db.add.assert_not_called()


async def test_admin_create_returns_email_user_without_fake_line(monkeypatch):
    svc = service("admin_user_service")
    db = database()
    user = User(id=31, email="ops@example.com", display_name="Ops", registered_at=utcnow())
    monkeypatch.setattr(svc.user_repo, "create", AsyncMock(return_value=user))
    monkeypatch.setattr(svc.tenant_repo, "create", AsyncMock(return_value=SimpleNamespace(id=41)))
    monkeypatch.setattr(svc.subscription_service, "start_default", AsyncMock())
    monkeypatch.setattr(svc.free_quota_service, "grant_personal", AsyncMock())
    user.created_at = utcnow()
    out = await svc.create(db, 9, " OPS@example.com ", " Ops ", None, "SafePass123")
    assert out.user_id == 31 and out.personal_tenant_id == 41 and not out.line_linked
    created = svc.user_repo.create.call_args
    assert created.args[1] is None and created.kwargs["email"] == "ops@example.com"
    assert await password_service.verify_password(created.kwargs["password_hash"], "SafePass123")
    assert "password" not in created.kwargs
    db.commit.assert_awaited_once()


async def test_admin_create_duplicate_email_is_conflict():
    svc = service("admin_user_service")
    db = database(scalar=7)
    with pytest.raises(AppError) as caught:
        await svc.create(db, 9, "ops@example.com", "Ops", None, "SafePass123")
    assert caught.value.code == "email_taken"
    db.add.assert_not_called()


@pytest.mark.parametrize(
    "table,error",
    [
        ("memberships", "user_has_organization"),
        ("files", "user_has_data"),
        ("review_records", "user_has_data"),
        ("report_assets", "user_has_data"),
        ("subscriptions", "user_has_billing"),
    ],
)
async def test_delete_rejects_associations_without_deleting(table, error):
    svc = service("admin_user_service")
    db = database()
    user = User(id=31)
    tenant = SimpleNamespace(id=41)
    monkey = pytest.MonkeyPatch()
    monkey.setattr(svc, "_locked", AsyncMock(return_value=(user, tenant)))

    async def scalar(statement):
        sql = str(statement)
        return 1 if f"{table}." in sql else None

    db.scalar.side_effect = scalar
    try:
        with pytest.raises(AppError) as caught:
            await svc.remove(db, 9, 31)
        assert caught.value.code == error
        assert not any(isinstance(c.args[0], Delete) for c in db.execute.call_args_list)
        db.commit.assert_not_awaited()
    finally:
        monkey.undo()


async def test_delete_empty_account_removes_only_technical_rows(monkeypatch):
    svc = service("admin_user_service")
    db = database()
    monkeypatch.setattr(
        svc, "_locked", AsyncMock(return_value=(User(id=31), SimpleNamespace(id=41)))
    )
    await svc.remove(db, 9, 31)
    removed = [
        c.args[0].table.name for c in db.execute.call_args_list if isinstance(c.args[0], Delete)
    ]
    assert removed == [
        "homepage_preferences",
        "impersonation_tickets",
        "email_codes",
        "customer_sessions",
        "free_quotas",
        "subscriptions",
        "tenants",
        "users",
    ]
    assert "audit_log" not in removed
    db.commit.assert_awaited_once()


async def test_line_link_preserves_user_and_tenant_and_uses_verified_subject(monkeypatch):
    svc = service("line_link_service")
    user = User(id=31, email="ops@example.com", line_user_id=None)
    user.registered_at = utcnow()
    db = database()
    identity = SimpleNamespace(
        sub="real-line-sub", picture="avatar", email="someone-else@example.com"
    )
    monkeypatch.setattr(svc.auth_service, "_identity", AsyncMock(return_value=identity))
    monkeypatch.setattr(svc.email_auth_service, "verify_for_link", AsyncMock(return_value=user))
    monkeypatch.setattr(svc.user_repo, "by_line_id", AsyncMock(return_value=None))
    monkeypatch.setattr(
        svc.tenant_repo, "personal_of", AsyncMock(return_value=SimpleNamespace(id=41))
    )
    monkeypatch.setattr(
        svc.auth_service,
        "open_user_session",
        AsyncMock(return_value=("cookie", Principal("user", 4, 41, 31))),
    )
    req = SimpleNamespace(email="ops@example.com", password="SafePass123", email_code=None)
    result = await svc.link(db, None, None, req, set(), None)
    assert user.line_user_id == "real-line-sub" and user.email == "ops@example.com"
    assert result[1].user_id == 31 and result[1].tenant_id == 41


async def test_line_link_conflict_does_not_merge_or_open_session(monkeypatch):
    svc = service("line_link_service")
    user = User(id=31, email="ops@example.com", line_user_id=None)
    db = database()
    monkeypatch.setattr(
        svc.auth_service,
        "_identity",
        AsyncMock(return_value=SimpleNamespace(sub="existing", picture=None)),
    )
    monkeypatch.setattr(svc.email_auth_service, "verify_for_link", AsyncMock(return_value=user))
    monkeypatch.setattr(
        svc.user_repo, "by_line_id", AsyncMock(return_value=User(id=32, line_user_id="existing"))
    )
    opened = AsyncMock()
    monkeypatch.setattr(svc.auth_service, "open_user_session", opened)
    req = SimpleNamespace(email="ops@example.com", password="SafePass123", email_code=None)
    with pytest.raises(AppError) as caught:
        await svc.link(db, None, None, req, set(), None)
    assert caught.value.code == "line_already_linked" and user.line_user_id is None
    opened.assert_not_awaited()


async def test_delete_rejects_consumed_quota(monkeypatch):
    svc = service("admin_user_service")
    db = database()
    monkeypatch.setattr(
        svc, "_locked", AsyncMock(return_value=(User(id=31), SimpleNamespace(id=41)))
    )

    async def consumed(statement):
        return 1 if "free_quotas." in str(statement) else None

    db.scalar.side_effect = consumed
    with pytest.raises(AppError) as caught:
        await svc.remove(db, 9, 31)
    assert caught.value.code == "user_has_data"
    assert not any(isinstance(c.args[0], Delete) for c in db.execute.call_args_list)


@pytest.mark.parametrize("password,code", [(None, None), ("SafePass123", "123456")])
async def test_line_link_requires_exactly_one_email_proof(password, code):
    svc = service("email_auth_service")
    with pytest.raises(AppError) as caught:
        await svc.verify_for_link(database(), "ops@example.com", password, code)
    assert caught.value.fields == ["password", "email_code"]


async def test_line_link_code_error_uses_email_code_field(monkeypatch):
    svc = service("email_auth_service")
    user = User(id=31, email="ops@example.com", registered_at=utcnow())
    monkeypatch.setattr(svc, "_registered", AsyncMock(return_value=user))
    monkeypatch.setattr(svc, "_failure", AsyncMock())
    monkeypatch.setattr(
        svc.email_code_service,
        "consume_code",
        AsyncMock(side_effect=AppError(400, "code_invalid", "error.code_invalid", ["code"])),
    )
    with pytest.raises(AppError) as caught:
        await svc.verify_for_link(database(), "ops@example.com", None, "123456")
    assert caught.value.fields == ["email_code"]


async def test_delete_constraint_race_rolls_back(monkeypatch):
    from sqlalchemy.exc import IntegrityError

    svc = service("admin_user_service")
    db = database()
    monkeypatch.setattr(
        svc, "_locked", AsyncMock(return_value=(User(id=31), SimpleNamespace(id=41)))
    )
    db.execute.side_effect = IntegrityError("delete", {}, Exception("foreign key"))
    with pytest.raises(AppError) as caught:
        await svc.remove(db, 9, 31)
    assert caught.value.code == "user_has_data"
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("mode", ["other_registered_user", "different_line"])
async def test_line_link_cannot_replace_another_identity(monkeypatch, mode):
    svc = service("line_link_service")
    user = User(
        id=31,
        email="ops@example.com",
        line_user_id="original" if mode == "different_line" else None,
    )
    original = user.line_user_id
    db = database()
    monkeypatch.setattr(
        svc.auth_service,
        "_identity",
        AsyncMock(return_value=SimpleNamespace(sub="new-line", picture=None)),
    )
    monkeypatch.setattr(svc.email_auth_service, "verify_for_link", AsyncMock(return_value=user))
    monkeypatch.setattr(svc.user_repo, "by_line_id", AsyncMock(return_value=None))
    monkeypatch.setattr(
        svc.user_repo, "get", AsyncMock(return_value=User(id=32, registered_at=utcnow()))
    )
    current = Principal("user", 4, 42, 32) if mode == "other_registered_user" else None
    req = SimpleNamespace(email="ops@example.com", password="SafePass123", email_code=None)
    with pytest.raises(AppError) as caught:
        await svc.link(db, None, current, req, set(), None)
    assert caught.value.code == "line_account_mismatch" and user.line_user_id == original
    db.rollback.assert_awaited_once()
    db.flush.assert_not_awaited()


async def test_optional_line_migration_refuses_unsafe_downgrade(monkeypatch):
    from tests.integration.db_fixtures import _migration

    migration = _migration("0023_optional_line_identity.py")
    connection = Mock()
    connection.execute.return_value.first.return_value = (1,)
    monkeypatch.setattr(migration.op, "get_bind", lambda: connection)
    alter = Mock()
    monkeypatch.setattr(migration.op, "alter_column", alter)
    with pytest.raises(RuntimeError, match="email-only users"):
        migration.downgrade()
    alter.assert_not_called()


async def test_impersonated_session_cannot_link_line():
    svc = service("line_link_service")
    with pytest.raises(AppError) as caught:
        await svc.link(database(), None, Principal("user", 4, 41, 31, 9), None, set(), None)
    assert caught.value.status == 403
