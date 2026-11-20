"""Import and export of the template structure JSON (FR-TEMPLATE-011)."""

from types import SimpleNamespace

import pytest

from app.errors import AppError
from app.ocr.templates.schema import validate_template
from app.schemas.template_management import CreateTemplateIn, TemplateExport
from app.services import template_management_service as svc
from tests.unit.test_template_management import valid


def _tpl(draft=None, code="po"):
    return SimpleNamespace(code=code, draft=draft)


def _ver(model):
    content = svc.version_content(model)
    return SimpleNamespace(
        name=content["name"], description=content["description"], groups=content["groups"]
    )


def test_import_ignores_control_fields():
    imported = {
        **valid(),
        "id": 1,
        "tenant_id": 2,
        "scope": "system",
        "owner": "x",
        "status": "DISABLED",
        "grant": {"mode": "PLANS", "plans": ["advance"]},
        "grant_mode": "TARGETS",
        "current_version": {"id": 3},
        "revision": 7,
        "applied_at": "2026-01-01",
        svc.PENDING_KEY: [{"path": "groups[0]", "attr": "required"}],
    }
    req = CreateTemplateIn(content=imported, source="import")
    content = svc.clean_content(req.content)
    assert content == valid()
    draft = svc.make_draft(content, [])
    assert svc.pending_of(draft) == []  # an import never carries pending confirmations


def test_export_current_version_has_no_control_data():
    model, _ = validate_template(valid())
    out = svc.export_content(_tpl(), _ver(model), draft=False)
    assert set(out) == {"code", "name", "description", "groups"}
    assert out["code"] == "po" and out["description"] == ""
    TemplateExport(**out)  # the response shape


def test_export_draft_drops_pending():
    pending = [{"path": "groups[0].items[0]", "attr": "required", "value": True}]
    draft = svc.make_draft({**valid(), "names": {"th": "ใบสั่งซื้อ"}}, pending)
    out = svc.export_content(_tpl(draft), None, draft=True)
    assert svc.PENDING_KEY not in out and out["names"] == {"th": "ใบสั่งซื้อ"}


def test_export_missing_is_404():
    with pytest.raises(AppError) as exc:
        svc.export_content(_tpl(), None, draft=False)
    assert exc.value.status == 404
    with pytest.raises(AppError):
        svc.export_content(_tpl(None), None, draft=True)


def test_round_trip_same_hash():
    model, _ = validate_template(valid())
    exported = svc.export_content(_tpl(), _ver(model), draft=False)
    reimported = svc.clean_content(exported)
    model2, errors = validate_template(reimported)
    assert errors == []
    assert svc.content_hash(svc.version_content(model2)) == svc.content_hash(
        svc.version_content(model)
    )
