"""Moved from main test_document_templates.py (ADR-009 class A): template schema rules."""

import copy
import json
from pathlib import Path

import pytest

from app.ocr.templates.schema import (
    TemplateValidationError,
    parse_template,
    validate_template,
)

SEED_DIR = Path(__file__).resolve().parents[3] / "app" / "ocr" / "seed"


def _seed(name: str) -> dict:
    return json.loads((SEED_DIR / f"{name}.json").read_text(encoding="utf-8"))


def _minimal(**over) -> dict:
    data = {
        "code": "t.min",
        "name": "Min",
        "groups": [
            {"key": "g", "name": "G", "items": [{"kind": "field", "key": "a", "name": "A"}]}
        ],
    }
    data.update(over)
    return data


# ---- 增量迁移规划（不执行 app.py 顶层，禁止连接共享库） ----


@pytest.mark.parametrize("name", ["billing_note", "tax_invoice"])
def test_seed_templates_are_valid(name):
    model, errors = validate_template(_seed(name))
    assert errors == [] and model is not None
    assert model.code == f"system.{name}"
    assert " / " in model.name  # 名称为「English / ไทย」


def test_defaults_are_filled():
    model = parse_template(_minimal())
    item = model.groups[0].items[0]
    assert (item.type, item.required, item.description) == ("string", False, "")


@pytest.mark.parametrize(
    "mutate, path",
    [
        (lambda d: d.update(code="Bad Code"), "code"),
        (lambda d: d.update(name=""), "name"),
        (lambda d: d.update(name="x" * 101), "name"),
        (lambda d: d.update(description="x" * 1001), "description"),
        (lambda d: d.update(groups=[]), "groups"),
        (lambda d: d["groups"][0].update(key="1g"), "groups[0].key"),
        (lambda d: d["groups"][0].update(items=[]), "groups[0].items"),
        (lambda d: d["groups"][0].update(description="x" * 501), "groups[0].description"),
        (lambda d: d["groups"][0]["items"][0].update(type="money"), "groups[0].items[0].type"),
        (
            lambda d: d["groups"][0]["items"][0].update(required="yes"),
            "groups[0].items[0].required",
        ),
        (lambda d: d["groups"][0]["items"][0].update(extra=1), "groups[0].items[0].extra"),
        (lambda d: d["groups"][0]["items"][0].pop("kind"), "groups[0].items[0]"),
        (
            lambda d: d["groups"][0]["items"].append(
                {"kind": "table", "key": "t", "name": "T", "columns": []}
            ),
            "groups[0].items[1].columns",
        ),
        (
            lambda d: d["groups"][0]["items"].append({"kind": "field", "key": "a", "name": "dup"}),
            "groups[0].items[1].key",
        ),
        (lambda d: d["groups"].append(copy.deepcopy(d["groups"][0])), "groups[1].key"),
        (
            lambda d: d["groups"][0]["items"].append(
                {
                    "kind": "table",
                    "key": "t",
                    "name": "T",
                    "columns": [{"key": "c", "name": "C"}, {"key": "c", "name": "C2"}],
                }
            ),
            "groups[0].items[1].columns[1].key",
        ),
    ],
)
def test_each_rule_reports_its_path(mutate, path):
    data = _minimal()
    mutate(data)
    model, errors = validate_template(data)
    assert model is None
    assert path in [e["path"] for e in errors], errors


def test_limits_on_totals():
    many_fields = [{"kind": "field", "key": f"f{i}", "name": "F"} for i in range(201)]
    _, errors = validate_template(
        _minimal(groups=[{"key": "g", "name": "G", "items": many_fields}])
    )
    assert any("exceeds 200" in e["message"] for e in errors)

    tables = [
        {"kind": "table", "key": f"t{i}", "name": "T", "columns": [{"key": "c", "name": "C"}]}
        for i in range(11)
    ]
    _, errors = validate_template(_minimal(groups=[{"key": "g", "name": "G", "items": tables}]))
    assert any("tables total 11" in e["message"] for e in errors)

    groups = [
        {"key": f"g{i}", "name": "G", "items": [{"kind": "field", "key": "a", "name": "A"}]}
        for i in range(21)
    ]
    _, errors = validate_template(_minimal(groups=groups))
    assert "groups" in [e["path"] for e in errors]


def test_all_errors_returned_at_once():
    data = _minimal(code="X", name="")
    data["groups"][0]["items"][0]["type"] = "money"
    data["groups"].append(copy.deepcopy(data["groups"][0]))
    _, errors = validate_template(data)
    paths = {e["path"] for e in errors}
    assert {
        "code",
        "name",
        "groups[0].items[0].type",
        "groups[1].items[0].type",
        "groups[1].key",
    } <= paths
    with pytest.raises(TemplateValidationError) as exc:
        parse_template(data)
    assert len(exc.value.errors) == len(errors)


def test_same_key_allowed_in_different_groups():
    data = _minimal()
    data["groups"].append(
        {"key": "h", "name": "H", "items": [{"kind": "field", "key": "a", "name": "A"}]}
    )
    assert validate_template(data)[1] == []


# ---- repository ----
