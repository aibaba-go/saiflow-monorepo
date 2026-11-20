from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.errors import AppError
from app.permissions import ALL
from app.services.tenant_access import TenantContext


def context(kind="organization"):
    return TenantContext(5, kind, 7, True, None, ALL)


@pytest.mark.parametrize("kind", ["personal", "organization"])
async def test_default_homepage_does_not_require_paid_reports(kind, monkeypatch):
    from app.services import homepage_service as home

    gate = AsyncMock(side_effect=AppError(403, "report_unavailable", "error.report_unavailable"))
    monkeypatch.setattr(home.reports, "require", gate)
    db = SimpleNamespace(get=AsyncMock(return_value=None))
    assert await home.read(db, context(kind)) == {"report_id": None, "default": kind}
    gate.assert_not_awaited()


@pytest.mark.parametrize("status", [403, 404])
async def test_unavailable_selected_report_falls_back_without_exposing_id(status, monkeypatch):
    from app.services import homepage_service as home

    monkeypatch.setattr(
        home.reports,
        "require",
        AsyncMock(side_effect=AppError(status, "not_found", "error.not_found")),
    )
    db = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(report_id=31)))
    assert await home.read(db, context()) == {"report_id": None, "default": "organization"}
    db.get.assert_awaited_once()
    assert db.get.call_args.args[1] == (7, 5)


async def test_ordinary_failure_is_not_a_default_homepage(monkeypatch):
    from app.services import homepage_service as home

    monkeypatch.setattr(home.reports, "require", AsyncMock(side_effect=RuntimeError("unavailable")))
    db = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(report_id=31)))
    with pytest.raises(RuntimeError):
        await home.read(db, context())


def test_homepage_routes_require_registered_identity_and_current_tenant():
    from app.dependencies import get_tenant_context, require_registered_user
    from app.routers.me import router

    routes = [r for r in router.routes if r.path == "/api/v1/me/homepage"]
    assert {m for r in routes for m in r.methods} == {"GET", "PUT"}
    for route in routes:
        calls = {d.call for d in route.dependant.dependencies}
        assert get_tenant_context in calls
        assert require_registered_user in calls


@pytest.mark.parametrize("value", [True, "31", 0, -1, 1.5, 2**63])
def test_homepage_choice_rejects_non_positive_integer_ids(value):
    from pydantic import ValidationError

    from app.routers.me import HomepageUpdate

    with pytest.raises(ValidationError):
        HomepageUpdate(report_id=value)


async def test_reset_is_scoped_to_user_and_tenant_without_paid_gate(monkeypatch):
    from app.services import homepage_service as home

    gate = AsyncMock(side_effect=AssertionError("reset must not require reports"))
    monkeypatch.setattr(home.reports, "require", gate)
    db = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    assert await home.choose(db, context("personal"), None) == {
        "report_id": None,
        "default": "personal",
    }
    statement = db.execute.call_args.args[0]
    assert statement.compile().params == {"user_id_1": 7, "tenant_id_1": 5}


async def test_choose_checks_readability_before_writing(monkeypatch):
    from app.services import homepage_service as home

    monkeypatch.setattr(home.reports, "require", AsyncMock())
    monkeypatch.setattr(home.reports, "get_report", AsyncMock())
    monkeypatch.setattr(
        home.reports,
        "published_page",
        AsyncMock(side_effect=AppError(404, "not_found", "error.not_found")),
    )
    db = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    with pytest.raises(AppError):
        await home.choose(db, context(), 31)
    db.execute.assert_not_awaited()
