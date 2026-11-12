import json

from fastapi.routing import APIRoute

from app.export_openapi import export
from app.main import create_app
from app.routers import exports, reports


def test_export_writes_sorted_spec_with_health(tmp_path):
    out = tmp_path / "openapi.json"
    export(out)
    text = out.read_text(encoding="utf-8")
    spec = json.loads(text)
    assert spec["paths"]["/api/v1/health"]["get"]["operationId"] == "getHealth"
    assert text.endswith("\n") and text == json.dumps(spec, indent=2, sort_keys=True) + "\n"


def test_export_is_deterministic(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    export(a)
    export(b)
    assert a.read_bytes() == b.read_bytes()


def test_download_head_routes_preserve_get_contract(settings):
    """FR-ENTRY-015/FR-REPORT-016: HEAD shares GET checks without changing client operations."""
    app = create_app(settings)
    spec = app.openapi()
    download_routes = [
        *exports.router.routes,
        *reports.router.routes,
        *reports.downloads_router.routes,
    ]
    downloads = {
        "/api/v1/exports/{export_id}/download": "downloadExport",
        "/api/v1/export-downloads/{token}": "redeemDownloadTicket",
        "/api/v1/reports/{report_id}/csv": "exportReportCsv",
        "/api/v1/report-downloads/{token}": "redeemReportCsvTicket",
    }
    for path, operation_id in downloads.items():
        assert set(spec["paths"][path]) == {"get"}
        assert spec["paths"][path]["get"]["operationId"] == operation_id
        routes = {
            method: route
            for route in download_routes
            if isinstance(route, APIRoute) and route.path == path
            for method in route.methods
        }
        assert set(routes) == {"GET", "HEAD"}
        assert routes["HEAD"].endpoint is routes["GET"].endpoint
        assert not routes["HEAD"].include_in_schema
    for path in ("/api/v1/exports/{export_id}/ticket", "/api/v1/reports/{report_id}/csv/ticket"):
        assert set(spec["paths"][path]) == {"post"}
        assert {
            method
            for route in download_routes
            if isinstance(route, APIRoute) and route.path == path
            for method in route.methods
        } == {"POST"}
