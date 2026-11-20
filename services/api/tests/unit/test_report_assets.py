import pytest

from app.errors import AppError


async def test_failed_asset_transaction_removes_the_unbound_object(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock

    from app.integrations.storage import MemoryStore
    from app.services import report_asset_service as assets

    monkeypatch.setattr(assets, "image_bytes", lambda raw: b"clean-png")
    monkeypatch.setattr(assets.reports, "audit", AsyncMock())
    db = SimpleNamespace(
        add=Mock(),
        commit=AsyncMock(side_effect=RuntimeError("database unavailable")),
        rollback=AsyncMock(),
    )
    store = MemoryStore()
    with pytest.raises(RuntimeError, match="database unavailable"):
        await assets.store_image(db, 5, assets.reports.admin_actor(1, 5), store, b"input")
    assert store.objects == {}


@pytest.mark.parametrize("format", ["png", "jpg"])
def test_jpeg_and_png_images_are_reencoded_as_png(format):
    import pymupdf

    from app.services.report_asset_service import image_bytes

    image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 2, 2), False)
    image.clear_with(128)
    clean = image_bytes(image.tobytes(format))
    assert clean.startswith(b"\x89PNG\r\n\x1a\n")
    decoded = pymupdf.Pixmap(clean)
    assert (decoded.width, decoded.height) == (2, 2)


async def test_static_cards_cannot_export_csv(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.services import report_csv_service as csv
    from app.services.tenant_access import TenantContext

    config = {
        "version": 1,
        "period": {"mode": "current_year"},
        "grid": {"cols": 12, "row_height": 80},
        "cards": [
            {
                "id": "a",
                "type": "html",
                "title": "Notes",
                "layout": {"x": 0, "y": 0, "w": 6, "h": 4},
                "content": {"mode": "html", "html": "<p>Notes</p>"},
            }
        ],
    }
    monkeypatch.setattr(
        csv.report_service,
        "published_page",
        AsyncMock(
            return_value=(
                SimpleNamespace(id=31),
                SimpleNamespace(config=config, name="Report", version=2),
            )
        ),
    )
    monkeypatch.setattr(csv.report_service, "snapshot_versions", AsyncMock(return_value={}))
    run = AsyncMock()
    monkeypatch.setattr(csv.report_query_service, "run_page", run)
    with pytest.raises(AppError) as raised:
        await csv.export(
            SimpleNamespace(),
            TenantContext(5, "organization", 7, False, 9, frozenset({"report_view", "export"})),
            31,
            "a",
            None,
        )
    assert raised.value.code == "report_export_failed"
    run.assert_not_awaited()


def test_report_assets_are_private_and_do_not_accept_svg_or_pdf():
    from app.services.report_asset_service import image_bytes

    for raw in (b'<svg xmlns="http://www.w3.org/2000/svg"/>', b"%PDF-1.7", b"not an image"):
        with pytest.raises(AppError):
            image_bytes(raw)


def test_report_asset_models_are_registered():
    from app.db import Base
    from app.models.report import HomepagePreference, ReportAsset

    assert Base.metadata.tables["saiflow_v3.report_assets"] is ReportAsset.__table__
    assert Base.metadata.tables["saiflow_v3.homepage_preferences"] is HomepagePreference.__table__


def test_html_sanitization_removes_network_and_execution_capabilities():
    from app.services.report_content import sanitize_html

    clean = sanitize_html(
        '<h2 onclick="alert(1)">Hello</h2><script>bad()</script>'
        '<img src="https://evil.invalid"><iframe src="https://evil.invalid"></iframe>'
        '<div style="color:#123456;background-image:url(https://evil.invalid)">Safe</div>'
    )
    assert clean == '<h2>Hello</h2><div style="color:#123456">Safe</div>'
    assert "evil" not in clean


def test_oversized_html_is_rejected_instead_of_silently_truncated():
    from app.services.report_content import sanitize_config

    with pytest.raises(AppError):
        sanitize_config({"cards": [{"id": "a", "type": "html", "content": {"html": "x" * 20001}}]})


@pytest.mark.parametrize(
    "url",
    [
        "https://safe.example/page?token=secret",
        "https://safe.example/#secret",
        "https://user:secret@safe.example/",
        "http://safe.example/",
    ],
)
def test_embeds_cannot_carry_credentials_or_tokens(url):
    from app.services.report_content import https_origin

    with pytest.raises(ValueError):
        https_origin(url)


def test_configured_embed_origin_works_with_local_http_pc_origin():
    from types import SimpleNamespace

    from app.services.report_content import sanitize_config

    cfg = {
        "cards": [
            {
                "id": "a",
                "type": "html",
                "content": {"mode": "url", "url": "https://safe.example/page"},
            }
        ]
    }
    settings = SimpleNamespace(
        report_embed_origins="https://safe.example", web_pc_origin="http://localhost:5173"
    )
    assert sanitize_config(cfg, settings) == cfg


async def test_malformed_page_filters_never_execute_unfiltered_query(monkeypatch):
    from datetime import UTC, datetime
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.services import report_query_service as query
    from app.services.report_config import VersionDef
    from tests.report_samples import GROUPS, card, page

    cfg = page(card("a"))
    cfg["filters"] = {"match": "invalid", "rules": [], "targets": {}}
    run = AsyncMock(return_value={"card_id": "a", "status": "ok"})
    monkeypatch.setattr(query, "run_card", run)
    result = await query.run_page(
        SimpleNamespace(commit=AsyncMock()),
        config=cfg,
        versions={10: VersionDef(10, 1, 1, GROUPS)},
        tenant_id=5,
        scope_user_id=7,
        override=None,
        now=datetime(2026, 11, 21, tzinfo=UTC),
    )
    assert result["cards"][0]["error_code"] == "invalid_config"
    run.assert_not_awaited()


def test_admin_asset_routes_require_admin_and_explicit_organization():
    from app.dependencies import get_admin
    from app.routers.admin_reports import router

    assets = [
        r
        for r in router.routes
        if r.path in {"/api/v1/admin/reports/assets", "/api/v1/admin/reports/assets/{asset_id}"}
    ]
    assert {m for r in assets for m in r.methods} == {"POST", "GET"}
    for route in assets:
        assert get_admin in {d.call for d in route.dependant.dependencies}
        assert "tenant_id" in {p.name for p in route.dependant.query_params}


async def test_viewer_cannot_read_unreferenced_private_image(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from uuid import uuid4

    from app.services import report_asset_service as assets
    from app.services.tenant_access import TenantContext

    monkeypatch.setattr(assets.reports, "require", AsyncMock())
    monkeypatch.setattr(
        assets.reports,
        "published_page",
        AsyncMock(return_value=(None, SimpleNamespace(config={"cards": []}))),
    )
    ctx = TenantContext(5, "organization", 7, False, 9, frozenset({"report_view"}))
    store = SimpleNamespace(get=AsyncMock())
    db = SimpleNamespace(scalar=AsyncMock(return_value=SimpleNamespace(object_key="private")))
    with pytest.raises(AppError) as raised:
        await assets.read(db, ctx, store, uuid4(), 31)
    assert raised.value.status == 404
    store.get.assert_not_awaited()
