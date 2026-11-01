"""套餐配置：校验、仓储缓存与后台脚本测试（FR-SYS-019）。

只使用内存 SQLite + 真实模型，不导入 app.py、不连接共享库。
"""
from __future__ import annotations

import copy
import json

import pytest
from flask import Flask

import manage_plans
import plans
from extensions import db
from models import AuditEvent, Plan


@pytest.fixture(autouse=True)
def fresh_cache():
    plans.invalidate()
    yield
    plans.invalidate()


@pytest.fixture()
def app():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite://", SQLALCHEMY_ENGINE_OPTIONS={})
    db.init_app(app)
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def _seed() -> list[dict]:
    return copy.deepcopy(plans.load_seed())


def _write(tmp_path, items, name="plans.json"):
    path = tmp_path / name
    path.write_text(json.dumps({"version": 1, "plans": items}, ensure_ascii=False), encoding="utf-8")
    return str(path)


# ---- 种子与校验 ----


def test_seed_reproduces_the_previous_hardcoded_catalog():
    seed = {c["code"]: c for c in plans.load_seed()}
    assert list(seed) == ["KINDER", "STARTER", "INTERMEDIATE", "ADVANCE"]
    assert {c: (p["quota_pages_per_month"], p["seats"]) for c, p in seed.items()} == {
        "KINDER": (1000, 1), "STARTER": (5000, 2), "INTERMEDIATE": (10000, 5), "ADVANCE": (100000, 10),
    }
    assert (seed["KINDER"]["yearly_thb"], seed["STARTER"]["monthly_thb"], seed["STARTER"]["yearly_thb"]) == (
        888, 599, 5990,
    )
    assert [c for c, p in seed.items() if p["is_default"]] == ["KINDER"]
    assert seed["KINDER"]["trial_months"] == 1
    assert all(p["approved_period_months"] == 12 for p in seed.values())
    assert seed["ADVANCE"]["theme"] == "DARK"


@pytest.mark.parametrize(
    "patch, path",
    [
        ({"name": {"en": "Kinder"}}, "plan.name.th"),
        ({"price_display": {"en": "x", "th": " "}}, "plan.price_display.th"),
        ({"features": {"en": ["a"], "th": []}}, "plan.features"),
        ({"trial_months": 0}, "plan.trial_months"),
        ({"approved_period_months": 121}, "plan.approved_period_months"),
        ({"quota_pages_per_month": True}, "plan.quota_pages_per_month"),
        ({"monthly_thb": -1}, "plan.monthly_thb"),
        ({"code": "kinder"}, "plan.code"),
        ({"theme": "NEON"}, "plan.theme"),
        ({"status": "ACTIVE"}, "plan.status"),
        ({"is_default": 1}, "plan.is_default"),
        ({"extra": 1}, "plan"),
    ],
)
def test_validate_plan_reports_each_problem(patch, path):
    raw = {**_seed()[0], **patch}
    config, errors = plans.validate_plan(raw)
    assert config is None
    assert path in [e["path"] for e in errors]


def test_validate_catalog_requires_exactly_one_enabled_default_and_unique_keys():
    seed = _seed()
    seed[1]["is_default"] = True
    _, errors = plans.validate_catalog(seed)
    assert any("恰好一个" in e["message"] for e in errors)

    seed = _seed()
    seed[0]["status"] = "DISABLED"
    _, errors = plans.validate_catalog(seed)
    assert any("必须是 ENABLED" in e["message"] for e in errors)

    seed = _seed()
    seed[2]["sort_order"] = seed[1]["sort_order"]
    _, errors = plans.validate_catalog(seed)
    assert [e["path"] for e in errors] == ["plans[2].sort_order"]


# ---- 仓储：读库、缓存、兜底 ----


def test_empty_table_falls_back_to_the_seed_and_startup_seeding_is_idempotent(app):
    assert [p["code"] for p in plans.catalog()] == ["KINDER", "STARTER", "INTERMEDIATE", "ADVANCE"]
    assert Plan.query.count() == 0
    assert plans.seed_if_empty() == 4
    assert plans.seed_if_empty() == 0
    assert Plan.query.count() == 4
    kinder = Plan.query.filter_by(code="KINDER").one()
    assert kinder.name == {"en": "Kinder", "th": "Kinder"} and kinder.is_default is True


def test_changes_are_visible_after_the_cache_window(app):
    plans.seed_if_empty()
    assert plans.get_plan("KINDER")["quota_pages_per_month"] == 1000
    Plan.query.filter_by(code="KINDER").one().quota_pages_per_month = 2000
    db.session.commit()
    # 缓存窗口内仍是旧值；窗口结束（或 CLI 写入后 invalidate）即读到新值
    assert plans.get_plan("KINDER")["quota_pages_per_month"] == 1000
    plans.invalidate()
    assert plans.get_plan("KINDER")["quota_pages_per_month"] == 2000


def test_disabled_plans_leave_the_catalog_but_still_resolve(app):
    plans.seed_if_empty()
    Plan.query.filter_by(code="INTERMEDIATE").one().status = "DISABLED"
    db.session.commit()
    plans.invalidate()
    assert [p["code"] for p in plans.catalog()] == ["KINDER", "STARTER", "ADVANCE"]
    assert plans.get_plan("INTERMEDIATE")["quota_pages_per_month"] == 10000
    assert plans.plan_rank("STARTER") < plans.plan_rank("INTERMEDIATE") < plans.plan_rank("ADVANCE")
    assert plans.plan_rank("NOPE") == -1
    # 未知 code 按默认套餐计量（不应发生：只停用不删除）
    assert plans.get_plan("NOPE")["code"] == "KINDER"


def test_rules_and_bilingual_views(app):
    plans.seed_if_empty()
    starter = Plan.query.filter_by(code="STARTER").one()
    starter.approved_period_months = 6
    starter.name = {"en": "Starter", "th": "สตาร์ตเตอร์"}
    db.session.commit()
    plans.invalidate()
    assert plans.default_plan()["code"] == "KINDER" and plans.default_plan()["trial_months"] == 1
    assert plans.approved_period_months("STARTER") == 6
    assert plans.plan_name("STARTER", "th") == "สตาร์ตเตอร์"
    assert plans.plan_name("STARTER", "jp") == "Starter"
    view = plans.public_view(plans.get_plan("STARTER"))
    assert set(view) == set(plans.PUBLIC_FIELDS)
    assert view["name"] == "Starter" and view["i18n"]["th"]["name"] == "สตาร์ตเตอร์"


def test_database_failure_falls_back_to_the_seed(monkeypatch):
    def broken():
        raise RuntimeError("synthetic outage")

    monkeypatch.setattr(plans, "_load_rows", broken)
    assert plans.get_plan("STARTER")["quota_pages_per_month"] == 5000
    assert plans.default_plan()["code"] == "KINDER"


def test_hand_edited_rows_missing_thai_fall_back_to_english(app):
    plans.seed_if_empty()
    row = Plan.query.filter_by(code="ADVANCE").one()
    row.name = {"en": "Advance"}
    row.features = {"en": ["A"]}
    db.session.commit()
    plans.invalidate()
    th = plans.get_plan("ADVANCE")["i18n"]["th"]
    assert th["name"] == "Advance" and th["features"] == ["A"]


# ---- 后台脚本 ----


def test_cli_validate_does_not_need_a_database(tmp_path, capsys):
    assert manage_plans.main(["validate", "--file", str(plans.SEED_PATH)]) == 0
    bad = _seed()
    bad[0]["trial_months"] = 0
    with pytest.raises(SystemExit) as exc:
        manage_plans.main(["validate", "--file", _write(tmp_path, bad)])
    assert exc.value.code == 2
    assert "plans[0].trial_months" in capsys.readouterr().out


def test_cli_seed_list_export_and_import_round_trip(app, tmp_path, capsys):
    assert manage_plans.main(["seed", "--dry-run"], app=app) == 0
    assert Plan.query.count() == 0
    assert manage_plans.main(["seed", "--yes"], app=app) == 0
    assert Plan.query.count() == 4
    assert manage_plans.main(["seed", "--yes"], app=app) == 0  # 已有配置不再导入
    assert Plan.query.count() == 4

    capsys.readouterr()
    manage_plans.main(["export"], app=app)
    exported = json.loads(capsys.readouterr().out)
    assert [p["code"] for p in exported["plans"]] == ["KINDER", "STARTER", "INTERMEDIATE", "ADVANCE"]

    changed = exported["plans"]
    changed[1]["quota_pages_per_month"] = 6000
    changed[1]["price_display"]["th"] = "THB 599 / เดือน"
    path = _write(tmp_path, changed)
    assert manage_plans.main(["import", "--file", path, "--dry-run"], app=app) == 0
    assert Plan.query.filter_by(code="STARTER").one().quota_pages_per_month == 5000
    out = capsys.readouterr().out
    assert "[dry-run] STARTER: 更新" in out and "KINDER: 无变化" in out

    plans.get_plan("STARTER")  # 预热缓存：写入后必须失效
    assert manage_plans.main(["import", "--file", path, "--yes"], app=app) == 0
    row = Plan.query.filter_by(code="STARTER").one()
    assert row.quota_pages_per_month == 6000 and row.price_display["th"] == "THB 599 / เดือน"
    assert plans.get_plan("STARTER")["quota_pages_per_month"] == 6000
    audit, = AuditEvent.query.filter_by(action="plan_config.import").all()
    assert audit.user_id is None and audit.object_id == "STARTER"
    assert audit.detail["source"] == "cli"
    assert set(audit.detail["fields"]) == {"quota_pages_per_month", "price_display"}


def test_cli_import_rejects_a_second_default_before_writing(app, tmp_path, capsys):
    manage_plans.main(["seed", "--yes"], app=app)
    item = _seed()[1]
    item["is_default"] = True
    with pytest.raises(SystemExit) as exc:
        manage_plans.main(["import", "--file", _write(tmp_path, [item]), "--yes"], app=app)
    assert exc.value.code == 2
    assert "恰好一个" in capsys.readouterr().out
    assert Plan.query.filter_by(is_default=True).count() == 1


def test_cli_import_can_add_a_new_plan(app, tmp_path):
    manage_plans.main(["seed", "--yes"], app=app)
    item = {**_seed()[3], "code": "ENTERPRISE", "sort_order": 50, "theme": "DEFAULT",
            "quota_pages_per_month": 500000,
            "name": {"en": "Enterprise", "th": "องค์กร"}}
    assert manage_plans.main(["import", "--file", _write(tmp_path, [item]), "--yes"], app=app) == 0
    assert [p["code"] for p in plans.catalog()][-1] == "ENTERPRISE"


def test_cli_set_status_and_default(app, capsys):
    manage_plans.main(["seed", "--yes"], app=app)
    assert manage_plans.main(
        ["set", "--code", "STARTER", "--pages", "7000", "--monthly-thb", "none", "--name-th", "สตาร์ตเตอร์",
         "--yes"], app=app,
    ) == 0
    row = Plan.query.filter_by(code="STARTER").one()
    assert (row.quota_pages_per_month, row.monthly_thb, row.name["th"]) == (7000, None, "สตาร์ตเตอร์")

    with pytest.raises(SystemExit) as exc:
        manage_plans.main(["set", "--code", "STARTER", "--trial-months", "0", "--yes"], app=app)
    assert exc.value.code == 2

    with pytest.raises(SystemExit) as exc:
        manage_plans.main(["disable", "--code", "KINDER", "--yes"], app=app)
    assert "不能停用" in str(exc.value.code)

    assert manage_plans.main(["disable", "--code", "INTERMEDIATE", "--yes"], app=app) == 0
    assert "INTERMEDIATE" not in [p["code"] for p in plans.catalog()]
    with pytest.raises(SystemExit):
        manage_plans.main(["set-default", "--code", "INTERMEDIATE", "--yes"], app=app)
    assert manage_plans.main(["enable", "--code", "INTERMEDIATE", "--yes"], app=app) == 0

    assert manage_plans.main(["set-default", "--code", "STARTER", "--yes"], app=app) == 0
    assert [r.code for r in Plan.query.filter_by(is_default=True).all()] == ["STARTER"]
    assert plans.default_plan()["code"] == "STARTER"
    capsys.readouterr()
    assert manage_plans.main(["list"], app=app) == 0
    assert "STARTER [ENABLED DEFAULT]" in capsys.readouterr().out


def test_cli_write_requires_confirmation(app, monkeypatch):
    manage_plans.main(["seed", "--yes"], app=app)
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    with pytest.raises(SystemExit) as exc:
        manage_plans.main(["set", "--code", "KINDER", "--pages", "1"], app=app)
    assert "已取消" in str(exc.value.code)
    assert Plan.query.filter_by(code="KINDER").one().quota_pages_per_month == 1000
