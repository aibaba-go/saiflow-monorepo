"""Template management content rules without a database (FR-TEMPLATE-005/011/013)."""

import importlib.util
import json
from pathlib import Path

import pytest

from app.errors import AppError
from app.ocr.templates.schema import validate_template
from app.services import template_management_service as svc

API_DIR = Path(__file__).resolve().parents[2]
SEED_DIR = API_DIR / "app" / "ocr" / "seed"


def _migration_0009():
    path = API_DIR / "alembic" / "versions" / "0009_ocr_scan_flow.py"
    spec = importlib.util.spec_from_file_location("m_0009_hash", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _seed(code: str) -> dict:
    return json.loads((SEED_DIR / f"{code}.json").read_text(encoding="utf-8"))


def valid(code: str = "po", name: str = "Purchase Order") -> dict:
    return {
        "code": code,
        "name": name,
        "groups": [
            {
                "key": "document",
                "name": "Document",
                "items": [{"kind": "field", "key": "po_no", "name": "PO No.", "primary": True}],
            }
        ],
    }


@pytest.mark.parametrize("code", ["tax_invoice", "billing_note"])
def test_hash_matches_migration_0009(code):
    seed = _seed(code)
    version = {
        "name": seed["name"],
        "description": seed.get("description"),
        "groups": seed["groups"],
    }
    assert svc.content_hash(version) == _migration_0009().content_hash(version)


def test_hash_ignores_key_order_and_non_content():
    a = {"name": "N", "description": "", "groups": [{"key": "g", "name": "G"}]}
    b = {"groups": [{"name": "G", "key": "g"}], "description": "", "name": "N", "revision": 9}
    assert svc.content_hash(a) == svc.content_hash(b)
    assert svc.content_hash(a) != svc.content_hash({**a, "name": "M"})


def test_version_content_is_canonical():
    model, errors = validate_template(valid())
    assert errors == []
    content = svc.version_content(model)
    assert set(content) == {"name", "description", "groups"}
    item = content["groups"][0]["items"][0]
    assert item["required"] is False and item["type"] == "string"  # defaults filled in
    # the same structure written with and without defaults hashes the same
    explicit = valid()
    explicit["groups"][0]["items"][0].update(required=False, type="string", description="")
    model2, _ = validate_template(explicit)
    assert svc.content_hash(svc.version_content(model2)) == svc.content_hash(content)


def test_clean_content_keeps_only_structure():
    raw = {
        **valid(),
        "id": 7,
        "tenant_id": 3,
        "status": "DISABLED",
        "grant_mode": "PLANS",
        "revision": 99,
        "versions": [],
        svc.PENDING_KEY: [{"path": "x", "attr": "required"}],
    }
    assert set(svc.clean_content(raw)) == {"code", "name", "groups"}


@pytest.mark.parametrize("raw", [None, [], "x", 3])
def test_clean_content_needs_an_object(raw):
    with pytest.raises(AppError) as exc:
        svc.clean_content(raw)
    assert (exc.value.status, exc.value.code, exc.value.fields) == (
        422,
        "validation_error",
        ["content"],
    )


def test_clean_content_size_limit():
    big = {**valid(), "description": "x" * (svc.MAX_CONTENT_BYTES + 1)}
    with pytest.raises(AppError) as exc:
        svc.clean_content(big)
    assert exc.value.code == "template_too_large"
    assert exc.value.message_key == "error.template_too_large"
    assert exc.value.details == {"limit_bytes": svc.MAX_CONTENT_BYTES}


@pytest.mark.parametrize("code", [None, "", "Has Space", "UPPER", 5, "-x"])
def test_content_code_required_and_valid(code):
    with pytest.raises(AppError) as exc:
        svc.content_code({"code": code})
    assert exc.value.fields == ["code"]


def test_content_name_falls_back_to_code():
    assert svc.content_name({"name": "  Order  "}, "po") == "Order"
    assert svc.content_name({"name": "  "}, "po") == "po"
    assert svc.content_name({}, "po") == "po"


def test_draft_errors_reported_for_incomplete_draft():
    assert svc.draft_errors(None) == []
    assert svc.draft_errors(svc.make_draft(valid(), [])) == []
    errors = svc.draft_errors({"code": "po", "name": "x", "groups": []})
    assert errors and errors[0]["path"] == "groups"
    # the internal pending list is not part of the validated content
    pending = [{"path": "groups[0].items[0]", "attr": "required", "value": True}]
    assert svc.draft_errors(svc.make_draft(valid(), pending)) == []


def test_pending_cleaned_and_only_removed():
    raw = [
        {"path": "a", "attr": "required", "value": True},
        {"path": "a", "attr": "required", "value": False},  # duplicate
        {"path": "b", "attr": "colour", "value": 1},  # unknown attribute
        {"path": 3, "attr": "role"},
        "junk",
        {"path": "c", "attr": "role", "value": {"x": 1}},  # value not scalar
    ]
    cleaned = svc.clean_pending(raw)
    assert cleaned == [
        {"path": "a", "attr": "required", "value": True},
        {"path": "c", "attr": "role", "value": None},
    ]
    assert svc.remaining_pending(cleaned, None) == cleaned  # not given: kept
    assert svc.remaining_pending(cleaned, []) == []  # all confirmed
    added = [{"path": "c", "attr": "role"}, {"path": "new", "attr": "primary"}]
    assert svc.remaining_pending(cleaned, added) == [cleaned[1]]  # cannot add


def test_pending_follows_a_reorder_without_growing():
    stored = [
        {"path": "groups[0].items[0]", "attr": "required", "value": True},
        {"path": "groups[0].items[1]", "attr": "primary", "value": True},
    ]
    # the two rows swapped places: both entries move, values from the stored ones
    moved = [
        {"path": "groups[0].items[1]", "attr": "required", "value": True},
        {"path": "groups[0].items[0]", "attr": "primary", "value": True},
    ]
    assert svc.remaining_pending(stored, moved) == moved
    # more entries than stored ones of that attribute: the extra one is dropped
    grown = [
        {"path": "groups[0].items[5]", "attr": "required", "value": True},
        {"path": "groups[0].items[6]", "attr": "required", "value": True},
    ]
    assert svc.remaining_pending(stored, grown) == [grown[0]]
    # the client cannot change the suggested value of an unmoved entry
    forged = [{"path": "groups[0].items[0]", "attr": "required", "value": False}]
    assert svc.remaining_pending(stored, forged) == [stored[0]]


def test_draft_round_trip_of_pending():
    pending = [{"path": "a", "attr": "primary", "value": True}]
    draft = svc.make_draft(valid(), pending)
    assert svc.pending_of(draft) == pending
    assert svc.PENDING_KEY not in svc.draft_content(draft)
    assert svc.PENDING_KEY not in svc.make_draft(valid(), [])
    assert svc.pending_of(None) == [] and svc.pending_of({svc.PENDING_KEY: "x"}) == []


def test_errors_use_i18n_keys():
    assert svc.revision_conflict(4).message_key == "error.revision_conflict"
    assert svc.revision_conflict(4).details == {"revision": 4}
    assert svc.code_conflict("po").message_key == "error.template_code_conflict"
    assert svc.invalid([]).message_key == "error.template_invalid"
