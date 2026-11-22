from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from pydantic import SecretStr

from app.config import Settings
from app.errors import AppError
from app.permissions import ALL
from app.services.tenant_access import TenantContext

NOW = datetime(2026, 11, 22, tzinfo=UTC)


@pytest.mark.parametrize("kind,width", [("personal", 5), ("organization", 7)])
def test_default_homepage_has_progress_usage_and_full_width_recent(kind, width):
    from app.services.dashboard_service import configuration

    config = configuration(kind)
    cards = {c["id"]: c for c in config["cards"]}
    assert len(cards) == 7
    assert cards["progress"]["layout"] == {"x": 0, "y": 2, "w": width, "h": 4}
    assert cards["usage"]["layout"] == {"x": width, "y": 2, "w": 12 - width, "h": 4}
    assert cards["recent"]["layout"] == {"x": 0, "y": 6, "w": 12, "h": 4}


async def test_admin_default_template_catalog_needs_no_tenant_or_database(settings):
    from types import SimpleNamespace

    import httpx

    from app.dependencies import get_admin
    from app.main import create_app

    app = create_app(settings)
    app.dependency_overrides[get_admin] = lambda: SimpleNamespace(account=SimpleNamespace(id=1))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        response = await client.get("/api/v1/admin/reports/homepage-templates")
    assert response.status_code == 200
    items = response.json()["items"]
    assert [i["kind"] for i in items] == ["personal", "organization"]
    assert all(i["source_id"] == "system-pg" and i["readonly"] for i in items)
    assert all(
        "counts" not in i and "usage" not in i and len(i["config"]["cards"]) == 7 for i in items
    )


@pytest.mark.parametrize(
    "kind,permissions,scope",
    [("personal", ALL, None), ("organization", ALL, None), ("organization", frozenset(), 7)],
)
async def test_fixed_dashboard_binds_authorized_scope_without_paid_gate(
    kind, permissions, scope, monkeypatch
):
    from app.services import dashboard_service as dashboard

    captured = []

    async def execute(settings, sql, params):
        captured.append((sql, params))
        if "GROUP BY stage" in sql:
            return [{"stage": "VERIFYING", "total": 3}]
        if "ORDER BY created_at" in sql:
            return [
                {"id": "9", "original_name": "Invoice", "stage": "VERIFYING", "created_at": NOW}
            ]
        return [{"plan_code": None, "ends_at": None, "quota": 0, "used": 0, "free_remaining": 0}]

    monkeypatch.setattr(dashboard, "system_report_rows", execute)
    monkeypatch.setattr(dashboard, "utcnow", lambda: NOW)
    ctx = TenantContext(5, kind, 7, True, None, permissions)
    settings = Settings(
        db_host="placeholder",
        db_name="placeholder",
        db_user="placeholder",
        db_password=SecretStr("private"),
    )
    result = await dashboard.read(settings, ctx)
    assert result["kind"] == kind
    assert result["counts"]["VERIFYING"] == 3
    assert result["counts"]["CONFIRMED"] == 0
    assert result["recent"][0]["id"] == "9"
    assert result["usage"]["used"] == 0
    assert result["config"]["cards"]
    assert all(params["tenant_id"] == 5 for _, params in captured)
    assert all(params["user_id"] == scope for sql, params in captured if "reporting.jobs" in sql)
    assert all("%(tenant_id)s" in sql for sql, _ in captured)
    assert "private" not in str(result)
    assert "SELECT" not in str(result)


async def test_dashboard_failure_is_not_zero_or_mock_data(monkeypatch):
    from app.services import dashboard_service as dashboard

    monkeypatch.setattr(
        dashboard,
        "system_report_rows",
        AsyncMock(
            side_effect=AppError(503, "data_source_unavailable", "error.data_source_unavailable")
        ),
    )
    with pytest.raises(AppError):
        await dashboard.read(
            Settings(
                db_host="placeholder",
                db_name="placeholder",
                db_user="placeholder",
                db_password=SecretStr("private"),
            ),
            TenantContext(5, "personal", 7, True, None, ALL),
        )


def test_dashboard_route_requires_registered_current_tenant():
    from app.dependencies import get_tenant_context, require_registered_user
    from app.routers.me import router

    routes = [r for r in router.routes if r.path == "/api/v1/me/dashboard"]
    assert len(routes) == 1
    calls = {d.call for d in routes[0].dependant.dependencies}
    assert get_tenant_context in calls
    assert require_registered_user in calls
