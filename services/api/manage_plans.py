"""套餐配置后台维护脚本（FR-SYS-019；PC 管理端后续接入，届时复用 plans.py 的校验与写入）。

用法（必须在 services/api 目录内执行）：

    .venv/Scripts/python.exe manage_plans.py list
    .venv/Scripts/python.exe manage_plans.py show --code KINDER
    .venv/Scripts/python.exe manage_plans.py export > ../../temp/plans.json
    .venv/Scripts/python.exe manage_plans.py validate --file ../../temp/plans.json
    .venv/Scripts/python.exe manage_plans.py import --file ../../temp/plans.json [--dry-run] [--yes]
    .venv/Scripts/python.exe manage_plans.py set --code STARTER --pages 6000 --yearly-thb 5990 [--dry-run] [--yes]
    .venv/Scripts/python.exe manage_plans.py enable|disable --code INTERMEDIATE [--yes]
    .venv/Scripts/python.exe manage_plans.py set-default --code KINDER [--yes]
    .venv/Scripts/python.exe manage_plans.py seed [--dry-run] [--yes]

约定：
- 文件格式即 plans 表的列：{"version": 1, "plans": [{code, sort_order, status, is_default,
  trial_months, approved_period_months, theme, monthly_thb, yearly_thb,
  quota_pages_per_month, seats, name{en,th}, price_display{en,th}, features{en[],th[]}}]}；
- import 按 code 新建或更新，文件里没有的套餐保持不变；套餐只停用、不删除（存量订阅仍引用）；
- 任何写入前都按「写入后的完整目录」校验（code/sort_order 唯一、启用套餐中恰好一个默认套餐），
  校验失败在写库前退出；`validate` 完全不连库；
- 写操作默认二次确认，`--yes` 跳过；`--dry-run` 只打印将要做的变更；
- 每次写入记审计（user_id 为空，detail.source = "cli"）；各实例在 plans.CACHE_TTL_SECONDS 内生效；
- 连接参数与 Flask 一致（PGHOST/PGUSER/...），不打印任何密码或连接串。
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from typing import Any

import plans as plan_config


def build_app():
    """与 manage_templates.py 一致的最小 Flask：只连库，不注册路由、不起 worker。"""
    from flask import Flask

    from config import Config
    from extensions import configure_schema, db

    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)
    configure_schema(app)
    return app


def _out(text: str = "") -> None:
    sys.stdout.write(text + "\n")


def _load_file(path: str) -> Any:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        raise SystemExit(f"文件不存在：{path}") from None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path} 不是合法 JSON：第 {exc.lineno} 行第 {exc.colno} 列 {exc.msg}") from None


def _print_errors(label: str, errors: list[dict]) -> None:
    _out(f"{label}: 校验失败，共 {len(errors)} 处错误")
    for err in errors:
        _out(f"  {err['path']}: {err['message']}")


def _check_file(path: str) -> list[dict]:
    """读取并逐条校验配置文件（文件内 code/sort_order 不得重复）；失败打印全部错误并退出。"""
    items = plan_config.parse_file_payload(_load_file(path))
    if not isinstance(items, list) or not items:
        _print_errors(path, [{"path": "plans", "message": "必须是非空数组"}])
        raise SystemExit(2)
    configs, errors = [], []
    for i, raw in enumerate(items):
        config, errs = plan_config.validate_plan(raw, f"plans[{i}]")
        errors.extend(errs)
        if config:
            configs.append(config)
    for field in ("code", "sort_order"):
        values = [c[field] for c in configs]
        dup = sorted({v for v in values if values.count(v) > 1}, key=str)
        if dup:
            errors.append({"path": "plans", "message": f"文件内 {field} 重复：{dup}"})
    if errors:
        _print_errors(path, errors)
        raise SystemExit(2)
    return configs


def _confirm(question: str, assume_yes: bool) -> None:
    if assume_yes:
        return
    answer = input(f"{question} [y/N] ").strip().lower()
    if answer not in ("y", "yes"):
        raise SystemExit("已取消，未写入任何数据")


def _fmt_price(value) -> str:
    return "-" if value is None else f"{value:,}"


def _summary(c: dict) -> str:
    default = " DEFAULT" if c["is_default"] else ""
    return (
        f"{c['code']} [{c['status']}{default}] sort={c['sort_order']} name={c['name']['en']!r}/{c['name']['th']!r}"
        f" pages/月={c['quota_pages_per_month']:,} seats={c['seats']}"
        f" THB 月={_fmt_price(c['monthly_thb'])} 年={_fmt_price(c['yearly_thb'])}"
        f" 默认开通月数={c['trial_months']} 审批续期月数={c['approved_period_months']} theme={c['theme']}"
    )


# ---- 库内读写 ----


def _rows() -> list:
    from models import Plan

    return Plan.query.order_by(Plan.sort_order.asc(), Plan.code.asc()).all()


def _config_of(row) -> dict:
    return {field: copy.deepcopy(getattr(row, field)) for field in plan_config.CONFIG_FIELDS}


def _plan_changes(current: list[dict], updates: list[dict]) -> tuple[list[dict], list[tuple[str, str, list[str]]]]:
    """按 code 合并；返回 (合并后的完整目录, [(code, action, changed_fields)])。"""
    merged = {c["code"]: copy.deepcopy(c) for c in current}
    changes = []
    for config in updates:
        before = merged.get(config["code"])
        if before is None:
            changes.append((config["code"], "create", []))
        else:
            fields = [f for f in plan_config.CONFIG_FIELDS if f != "code" and before[f] != config[f]]
            changes.append((config["code"], "update" if fields else "unchanged", fields))
        merged[config["code"]] = copy.deepcopy(config)
    ordered = sorted(merged.values(), key=lambda c: (c["sort_order"], c["code"]))
    return ordered, changes


def _validate_merged(configs: list[dict]) -> None:
    _, errors = plan_config.validate_catalog(configs)
    if errors:
        _print_errors("写入后的完整目录", errors)
        raise SystemExit(2)


def _report(changes, *, dry_run: bool) -> None:
    prefix = "[dry-run] " if dry_run else ""
    labels = {"create": "新建", "update": "更新", "unchanged": "无变化"}
    for code, action, fields in changes:
        detail = f" 字段={fields}" if fields else ""
        _out(f"{prefix}{code}: {labels[action]}{detail}")


def _write(configs_by_code: dict[str, dict], changes, action: str) -> None:
    """按变更清单落库 + 审计（同一事务），提交后清缓存。"""
    from extensions import db
    from models import AuditEvent, Plan

    rows = {row.code: row for row in _rows()}
    for code, kind, fields in changes:
        if kind == "unchanged":
            continue
        row = rows.get(code)
        if row is None:
            row = Plan(code=code)
            db.session.add(row)
        changed = plan_config.apply_config(row, configs_by_code[code])
        db.session.add(
            AuditEvent(
                user_id=None,
                action=action,
                object_type="plan",
                object_id=code,
                detail={"source": "cli", "change": kind, "fields": changed or fields},
            )
        )
    db.session.commit()
    plan_config.invalidate()


def _apply(updates: list[dict], *, action: str, dry_run: bool, assume_yes: bool, question: str) -> int:
    current = [_config_of(row) for row in _rows()]
    merged, changes = _plan_changes(current, updates)
    _validate_merged(merged)
    _report(changes, dry_run=dry_run)
    pending = [c for c in changes if c[1] != "unchanged"]
    if dry_run:
        return 0
    if not pending:
        _out("配置无变化，未写入")
        return 0
    _confirm(question.format(n=len(pending)), assume_yes)
    _write({c["code"]: c for c in merged}, changes, action)
    _out(f"已写入 {len(pending)} 个套餐；各实例将在 {plan_config.CACHE_TTL_SECONDS} 秒内生效")
    return 0


def _get(code: str):
    row = next((r for r in _rows() if r.code == code), None)
    if row is None:
        raise SystemExit(f"套餐 {code} 不存在（先 seed 或 import）")
    return row


# ---- 子命令 ----


def cmd_validate(args) -> int:
    configs = _check_file(args.file)
    _, errors = plan_config.validate_catalog(configs)
    _out(f"{args.file}: 逐条校验通过，共 {len(configs)} 个套餐")
    if errors:
        # 文件可以只含部分套餐（import 时与库内合并）；完整性在 import 时按合并结果再校验
        _out("  提示：按完整目录校验未通过（若文件只含部分套餐可忽略，import 时会按合并结果校验）：")
        for err in errors:
            _out(f"    {err['path']}: {err['message']}")
    return 0


def cmd_list(args) -> int:
    rows = _rows()
    if not rows:
        _out("plans 表为空（运行期使用内置种子 plans_seed.json；可执行 seed 导入）")
        return 0
    _out(f"套餐 {len(rows)} 个：")
    for row in rows:
        _out(f"  {_summary(_config_of(row))}")
    return 0


def cmd_show(args) -> int:
    row = _get(args.code)
    payload = {
        **_config_of(row),
        "created_at": row.created_at.isoformat(timespec="seconds") if row.created_at else None,
        "updated_at": row.updated_at.isoformat(timespec="seconds") if row.updated_at else None,
    }
    _out(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_export(args) -> int:
    rows = _rows()
    if not rows:
        raise SystemExit("plans 表为空，没有可导出的配置（内置种子见 plans_seed.json）")
    _out(json.dumps({"version": 1, "plans": [_config_of(r) for r in rows]}, ensure_ascii=False, indent=2))
    return 0


def cmd_import(args) -> int:
    updates = _check_file(args.file)
    return _apply(
        updates, action="plan_config.import", dry_run=args.dry_run, assume_yes=args.yes,
        question=f"确认按 {args.file} 写入 {{n}} 个套餐？改动对所有租户（含存量订阅）生效",
    )


def cmd_seed(args) -> int:
    if _rows():
        _out("plans 表已有配置，seed 只在表为空时导入；修改请用 import / set")
        return 0
    seed = plan_config.load_seed()
    for config in seed:
        _out(f"{'[dry-run] ' if args.dry_run else ''}将导入 {_summary(config)}")
    if args.dry_run:
        return 0
    _confirm(f"确认导入内置种子 {len(seed)} 个套餐？", args.yes)
    _write({c["code"]: c for c in seed}, [(c["code"], "create", []) for c in seed], "plan_config.seed")
    _out(f"已导入 {len(seed)} 个套餐")
    return 0


_SET_FIELDS = (
    ("pages", "quota_pages_per_month"),
    ("seats", "seats"),
    ("monthly_thb", "monthly_thb"),
    ("yearly_thb", "yearly_thb"),
    ("sort_order", "sort_order"),
    ("trial_months", "trial_months"),
    ("approved_months", "approved_period_months"),
    ("theme", "theme"),
    ("name_en", ("name", "en")),
    ("name_th", ("name", "th")),
    ("price_en", ("price_display", "en")),
    ("price_th", ("price_display", "th")),
)


def _price_arg(value: str):
    """价格参数：整数，或 none 表示面议（NULL）。"""
    if value.strip().lower() in ("none", "null", ""):
        return None
    try:
        return int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("必须是整数或 none") from None


def cmd_set(args) -> int:
    config = _config_of(_get(args.code))
    touched = False
    for arg, field in _SET_FIELDS:
        value = getattr(args, arg)
        if value is _UNSET:
            continue
        touched = True
        if isinstance(field, tuple):
            config[field[0]] = {**config[field[0]], field[1]: value}
        else:
            config[field] = value
    if not touched:
        raise SystemExit("没有指定任何要修改的字段（见 set --help）")
    checked, errors = plan_config.validate_plan(config, args.code)
    if errors:
        _print_errors(args.code, errors)
        raise SystemExit(2)
    return _apply(
        [checked], action="plan_config.update", dry_run=args.dry_run, assume_yes=args.yes,
        question=f"确认修改套餐 {args.code}？改动对所有租户（含存量订阅）生效",
    )


def _status_cmd(target: str):
    def run(args) -> int:
        config = _config_of(_get(args.code))
        if target == "DISABLED" and config["is_default"]:
            raise SystemExit(f"{args.code} 是默认套餐，不能停用；先 set-default 换成其他套餐")
        config["status"] = target
        return _apply(
            [config], action="plan_config.status", dry_run=False, assume_yes=args.yes,
            question=f"确认将套餐 {args.code} 改为 {target}？",
        )

    return run


def cmd_set_default(args) -> int:
    current = [_config_of(row) for row in _rows()]
    target = next((c for c in current if c["code"] == args.code), None)
    if target is None:
        raise SystemExit(f"套餐 {args.code} 不存在（先 seed 或 import）")
    if target["status"] != "ENABLED":
        raise SystemExit(f"{args.code} 已停用，先 enable 再设为默认套餐")
    updates = []
    for config in current:
        want = config["code"] == args.code
        if config["is_default"] != want:
            updates.append({**config, "is_default": want})
    if not updates:
        _out(f"{args.code} 已是默认套餐，无需变更")
        return 0
    return _apply(
        updates, action="plan_config.default", dry_run=False, assume_yes=args.yes,
        question=f"确认把默认开通套餐改为 {args.code}？只影响之后新开通的租户",
    )


_UNSET = object()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SaiFlow 套餐配置后台维护")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="列出全部套餐（含停用）").set_defaults(handler=cmd_list)

    p = sub.add_parser("show", help="输出单个套餐的配置 JSON")
    p.add_argument("--code", required=True)
    p.set_defaults(handler=cmd_show)

    sub.add_parser("export", help="把库内全部套餐输出为配置文件 JSON").set_defaults(handler=cmd_export)

    p = sub.add_parser("validate", help="只校验配置文件，不连接数据库")
    p.add_argument("--file", required=True)
    p.set_defaults(handler=cmd_validate, needs_db=False)

    p = sub.add_parser("import", help="按 code 新建或更新套餐（文件里没有的保持不变）")
    p.add_argument("--file", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_import)

    p = sub.add_parser("set", help="修改单个套餐的常用字段")
    p.add_argument("--code", required=True)
    p.add_argument("--pages", type=int, default=_UNSET, help="每月页数额度")
    p.add_argument("--seats", type=int, default=_UNSET, help="席位数（仅展示）")
    p.add_argument("--monthly-thb", type=_price_arg, default=_UNSET, help="月付价格；none=面议")
    p.add_argument("--yearly-thb", type=_price_arg, default=_UNSET, help="年付价格；none=面议")
    p.add_argument("--sort-order", type=int, default=_UNSET, help="档位顺序（升序，不可重复）")
    p.add_argument("--trial-months", type=int, default=_UNSET, help="作为默认套餐时的开通月数 1~120")
    p.add_argument("--approved-months", type=int, default=_UNSET, help="审批默认续期月数 1~120")
    p.add_argument("--theme", choices=plan_config.THEMES, default=_UNSET)
    p.add_argument("--name-en", default=_UNSET)
    p.add_argument("--name-th", default=_UNSET)
    p.add_argument("--price-en", default=_UNSET, help="英文价格展示文案")
    p.add_argument("--price-th", default=_UNSET, help="泰文价格展示文案")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_set)

    for action, target, text in (("enable", "ENABLED", "启用"), ("disable", "DISABLED", "停用")):
        p = sub.add_parser(action, help=f"{text}套餐（停用后不展示、不可申请，存量订阅照常计量）")
        p.add_argument("--code", required=True)
        p.add_argument("--yes", action="store_true")
        p.set_defaults(handler=_status_cmd(target))

    p = sub.add_parser("set-default", help="设置默认开通套餐（只影响之后新开通的租户）")
    p.add_argument("--code", required=True)
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_set_default)

    p = sub.add_parser("seed", help="plans 表为空时导入内置种子 plans_seed.json")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_seed)
    return parser


def main(argv: list[str] | None = None, *, app=None) -> int:
    # 套餐文案含泰文；Windows 控制台默认 GBK，统一按 UTF-8 输出，无法显示的字符替换
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass
    args = build_parser().parse_args(argv)
    if getattr(args, "needs_db", True) is False:
        return args.handler(args)
    if args.command == "import":
        _check_file(args.file)  # 连库之前先校验
    app = app or build_app()
    with app.app_context():
        return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
