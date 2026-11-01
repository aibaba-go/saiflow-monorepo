"""模板结构校验、仓储与后台脚本测试（FR-TEMPLATE-001..003/005，design D2–D4）。

只使用内存 SQLite + 真实模型，不导入 app.py、不连接共享库。
"""
from __future__ import annotations

import ast
import copy
import json
import sqlite3
from pathlib import Path

import pytest
from flask import Flask

import manage_templates
from doc_templates import repository as repo
from doc_templates.schema import (
    TemplateValidationError,
    parse_template,
    validate_template,
)
from extensions import db
from models import AuditEvent, DocumentTemplate, DocumentTemplateVersion, Tenant

SEED_DIR = Path(__file__).resolve().parent / "templates_seed"


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


@pytest.fixture()
def app():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite://", SQLALCHEMY_ENGINE_OPTIONS={})
    db.init_app(app)
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=7, tenant_type="PERSONAL", display_name="t7"))
        db.session.add(Tenant(id=8, tenant_type="PERSONAL", display_name="t8"))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


# ---- 增量迁移规划（不执行 app.py 顶层，禁止连接共享库） ----


def _migration_planner():
    source = Path(__file__).resolve().parent / "app.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    names = {"_ADD_COLUMNS", "_ADD_INDEXES", "_CURRENT_VERSION_INDEX", "_pending_schema_stmts"}
    nodes = [node for node in tree.body if (
        isinstance(node, ast.FunctionDef) and node.name in names
    ) or (
        isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in names
                                            for target in node.targets)
    )]
    namespace = {}
    # 仅执行仓库内白名单常量/纯函数 AST，不包含任何 import 或应用启动表达式。
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), namespace)  # noqa: S102
    assert names.issubset(namespace)
    return namespace


def test_incremental_mapping_columns_preserve_old_rows_and_are_idempotent():
    ns = _migration_planner()
    mapping_columns = {("ocr_jobs", "current_mapping_id"), ("ocr_jobs", "pending_mapping_id"),
                       ("result_versions", "mapping_id")}
    columns = {(table, col): ddl.lower() for table, col, ddl in ns["_ADD_COLUMNS"]
               if (table, col) not in mapping_columns}
    columns[("users", "avatar_url")] = "text"
    indexes = {name for name, _ in ns["_ADD_INDEXES"]} | {"uq_result_versions_job_current"}
    planned = ns["_pending_schema_stmts"](columns, {}, indexes, False)
    assert len(planned) == 3 and all("VARCHAR(36)" in stmt for stmt in planned)
    with sqlite3.connect(":memory:") as conn:
        conn.execute("CREATE TABLE ocr_jobs (id TEXT PRIMARY KEY)")
        conn.execute("CREATE TABLE result_versions (id TEXT PRIMARY KEY)")
        conn.execute("INSERT INTO ocr_jobs VALUES ('synthetic-old-job')")
        conn.execute("INSERT INTO result_versions VALUES ('synthetic-old-version')")
        for stmt in planned:
            # SQLite 不支持 ADD COLUMN IF NOT EXISTS；只验证相同列定义和旧行 NULL 保留。
            conn.execute(stmt.replace("ADD COLUMN IF NOT EXISTS", "ADD COLUMN"))
        assert conn.execute("SELECT current_mapping_id, pending_mapping_id FROM ocr_jobs").fetchone() == (None, None)
        assert conn.execute("SELECT mapping_id FROM result_versions").fetchone() == (None,)
    columns.update({pair: "character varying" for pair in mapping_columns})
    assert ns["_pending_schema_stmts"](columns, {}, indexes, False) == []


@pytest.mark.parametrize("duplicates", [False, True])
def test_current_version_partial_index_is_guarded_by_readonly_duplicate_check(duplicates):
    ns = _migration_planner()
    columns = {(table, col): ddl.lower() for table, col, ddl in ns["_ADD_COLUMNS"]}
    columns[("users", "avatar_url")] = "text"
    indexes = {name for name, _ in ns["_ADD_INDEXES"]}
    planned = ns["_pending_schema_stmts"](columns, {}, indexes, duplicates)
    assert planned == ([] if duplicates else [ns["_CURRENT_VERSION_INDEX"]])


# ---- schema ----


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
        (lambda d: d["groups"][0]["items"][0].update(required="yes"), "groups[0].items[0].required"),
        (lambda d: d["groups"][0]["items"][0].update(extra=1), "groups[0].items[0].extra"),
        (lambda d: d["groups"][0]["items"][0].pop("kind"), "groups[0].items[0]"),
        (lambda d: d["groups"][0]["items"].append({"kind": "table", "key": "t", "name": "T", "columns": []}),
         "groups[0].items[1].columns"),
        (lambda d: d["groups"][0]["items"].append({"kind": "field", "key": "a", "name": "dup"}),
         "groups[0].items[1].key"),
        (lambda d: d["groups"].append(copy.deepcopy(d["groups"][0])), "groups[1].key"),
        (lambda d: d["groups"][0]["items"].append(
            {"kind": "table", "key": "t", "name": "T",
             "columns": [{"key": "c", "name": "C"}, {"key": "c", "name": "C2"}]}),
         "groups[0].items[1].columns[1].key"),
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
    _, errors = validate_template(_minimal(groups=[{"key": "g", "name": "G", "items": many_fields}]))
    assert any("exceeds 200" in e["message"] for e in errors)

    tables = [{"kind": "table", "key": f"t{i}", "name": "T", "columns": [{"key": "c", "name": "C"}]}
              for i in range(11)]
    _, errors = validate_template(_minimal(groups=[{"key": "g", "name": "G", "items": tables}]))
    assert any("tables total 11" in e["message"] for e in errors)

    groups = [{"key": f"g{i}", "name": "G", "items": [{"kind": "field", "key": "a", "name": "A"}]}
              for i in range(21)]
    _, errors = validate_template(_minimal(groups=groups))
    assert "groups" in [e["path"] for e in errors]


def test_all_errors_returned_at_once():
    data = _minimal(code="X", name="")
    data["groups"][0]["items"][0]["type"] = "money"
    data["groups"].append(copy.deepcopy(data["groups"][0]))
    _, errors = validate_template(data)
    paths = {e["path"] for e in errors}
    assert {"code", "name", "groups[0].items[0].type", "groups[1].items[0].type", "groups[1].key"} <= paths
    with pytest.raises(TemplateValidationError) as exc:
        parse_template(data)
    assert len(exc.value.errors) == len(errors)


def test_same_key_allowed_in_different_groups():
    data = _minimal()
    data["groups"].append({"key": "h", "name": "H", "items": [{"kind": "field", "key": "a", "name": "A"}]})
    assert validate_template(data)[1] == []


# ---- repository ----


def test_import_is_idempotent_and_versions_on_change(app):
    first = repo.import_template(_seed("billing_note"))
    db.session.commit()
    assert first["action"] == "created" and first["version"] == 1

    again = repo.import_template(_seed("billing_note"))
    assert again["action"] == "unchanged"

    # 显式写出缺省值不算内容变化
    explicit = _seed("billing_note")
    explicit["groups"][0]["items"][0]["required"] = False
    explicit["groups"][0]["items"][0]["type"] = "string"
    assert repo.import_template(explicit)["action"] == "unchanged"

    changed = _seed("billing_note")
    changed["description"] += " v2"
    res = repo.import_template(changed)
    db.session.commit()
    assert res["action"] == "versioned" and res["version"] == 2

    tpl = db.session.get(DocumentTemplate, first["template_id"])
    v1 = repo.get_version(tpl, 1)
    v2 = repo.current_version(tpl)
    assert v2.version == 2 and v1.description == _seed("billing_note")["description"]
    assert v1.content_hash != v2.content_hash
    actions = [a.action for a in AuditEvent.query.order_by(AuditEvent.id).all()]
    assert actions == ["template.created", "template.versioned"]
    assert AuditEvent.query.first().user_id is None
    assert AuditEvent.query.first().detail["source"] == "cli"


def test_groups_keep_template_order(app):
    res = repo.import_template(_seed("tax_invoice"))
    db.session.commit()
    ver = db.session.get(DocumentTemplateVersion, res["template_version_id"])
    db.session.expire_all()
    ver = db.session.get(DocumentTemplateVersion, res["template_version_id"])
    assert [g["key"] for g in ver.groups] == [g["key"] for g in _seed("tax_invoice")["groups"]]


def test_dry_run_writes_nothing(app):
    res = repo.import_template(_seed("tax_invoice"), dry_run=True)
    db.session.commit()
    assert res["action"] == "created"
    assert DocumentTemplate.query.count() == 0 and AuditEvent.query.count() == 0


def test_scopes_visibility_disable_and_delete(app):
    sys_res = repo.import_template(_minimal(code="shared"))
    t7 = repo.import_template(_minimal(code="shared", name="T7"), tenant_id=7)
    repo.import_template(_minimal(code="only8"), tenant_id=8)
    db.session.commit()
    assert sys_res["template_id"] != t7["template_id"]  # 同 code 不同作用域互不冲突

    codes = sorted(t.code for t, _ in repo.available_versions(7))
    assert codes == ["shared", "shared"]
    assert sorted(t.code for t, _ in repo.available_versions(None)) == ["shared"]

    assert repo.set_status(t7["template_id"], repo.DISABLED) is True
    assert repo.set_status(t7["template_id"], repo.DISABLED) is False
    db.session.commit()
    assert [t.tenant_id for t, _ in repo.available_versions(7)] == [None]

    repo.soft_delete(sys_res["template_id"])
    db.session.commit()
    assert repo.available_versions(7) == []
    # 软删除后可重新导入同 code，生成新模板
    again = repo.import_template(_minimal(code="shared"))
    db.session.commit()
    assert again["action"] == "created" and again["template_id"] != sys_res["template_id"]


def test_unknown_tenant_rejected(app):
    with pytest.raises(ValueError):
        repo.import_template(_minimal(), tenant_id=999)


def test_version_availability(app):
    res = repo.import_template(_minimal())
    db.session.commit()
    v1 = db.session.get(DocumentTemplateVersion, res["template_version_id"])
    assert repo.is_version_available(v1, 7)
    repo.import_template(_minimal(name="Min v2"))
    db.session.commit()
    assert not repo.is_version_available(v1, 7)  # 旧版本不再用于新映射


# ---- 脚本 ----


def test_cli_validate_does_not_touch_db(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(manage_templates, "build_app", lambda: (_ for _ in ()).throw(AssertionError("db")))
    assert manage_templates.main(["validate", "--file", str(SEED_DIR / "tax_invoice.json")]) == 0
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"code": "X"}), encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        manage_templates.main(["validate", "--file", str(bad)])
    assert exc.value.code == 2
    assert "校验失败" in capsys.readouterr().out


def test_cli_import_invalid_exits_before_db(monkeypatch, tmp_path):
    monkeypatch.setattr(manage_templates, "build_app", lambda: (_ for _ in ()).throw(AssertionError("db")))
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    with pytest.raises(SystemExit):
        manage_templates.main(["import", "--file", str(bad), "--yes"])


def test_cli_seed_dry_run_then_seed_then_idempotent(app, capsys):
    assert manage_templates.main(["seed", "--dry-run"], app=app) == 0
    out = capsys.readouterr().out
    assert out.count("[dry-run]") == 2 and DocumentTemplate.query.count() == 0

    assert manage_templates.main(["seed", "--yes"], app=app) == 0
    codes = sorted(t.code for t in DocumentTemplate.query.all())
    assert codes == ["system.billing_note", "system.tax_invoice"]
    assert all(t.tenant_id is None and t.status == "ENABLED" for t in DocumentTemplate.query.all())

    capsys.readouterr()
    assert manage_templates.main(["seed", "--yes"], app=app) == 0
    assert "均已是最新" in capsys.readouterr().out
    assert DocumentTemplateVersion.query.count() == 2


def test_cli_confirm_cancel_writes_nothing(app, monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _q: "n")
    with pytest.raises(SystemExit):
        manage_templates.main(["seed"], app=app)
    assert DocumentTemplate.query.count() == 0


def test_cli_import_export_status_commands(app, capsys, tmp_path):
    path = tmp_path / "t.json"
    path.write_text(json.dumps(_minimal(code="tenant.po")), encoding="utf-8")
    assert manage_templates.main(["import", "--file", str(path), "--tenant-id", "7", "--yes"], app=app) == 0
    tpl = DocumentTemplate.query.filter_by(code="tenant.po").one()
    assert tpl.tenant_id == 7

    capsys.readouterr()
    manage_templates.main(["export", "--id", str(tpl.id)], app=app)
    exported = json.loads(capsys.readouterr().out)
    assert exported["code"] == "tenant.po" and exported["groups"][0]["items"][0]["type"] == "string"

    manage_templates.main(["disable", "--id", str(tpl.id), "--yes"], app=app)
    db.session.expire_all()  # 脚本在嵌套 app_context 中使用独立会话
    assert db.session.get(DocumentTemplate, tpl.id).status == "DISABLED"
    manage_templates.main(["enable", "--id", str(tpl.id), "--yes"], app=app)
    manage_templates.main(["delete", "--id", str(tpl.id), "--yes"], app=app)
    db.session.expire_all()
    assert db.session.get(DocumentTemplate, tpl.id).deleted_at is not None

    capsys.readouterr()
    manage_templates.main(["list", "--include-deleted"], app=app)
    assert "DELETED" in capsys.readouterr().out
    actions = [a.action for a in AuditEvent.query.order_by(AuditEvent.id).all()]
    assert actions == ["template.created", "template.disabled", "template.enabled", "template.deleted"]
