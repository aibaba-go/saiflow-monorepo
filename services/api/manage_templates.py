"""单据模板后台维护脚本（FR-TEMPLATE-001..003/005，design D4；管理界面延后，见 R1）。

用法（必须在 services/api 目录内执行）：

    .venv/Scripts/python.exe manage_templates.py list [--tenant-id N | --system] [--include-deleted]
    .venv/Scripts/python.exe manage_templates.py show --id 3 [--version 2]
    .venv/Scripts/python.exe manage_templates.py validate --file templates_seed/tax_invoice.json
    .venv/Scripts/python.exe manage_templates.py import --file my.json [--tenant-id 12] [--dry-run] [--yes]
    .venv/Scripts/python.exe manage_templates.py export --id 3 > my.json
    .venv/Scripts/python.exe manage_templates.py enable|disable|delete --id 3 [--yes]
    .venv/Scripts/python.exe manage_templates.py seed [--dry-run] [--yes]

约定：
- 写操作默认二次确认，`--yes` 跳过；`--dry-run` 只打印将要做的变更，不写库；
- 模板校验失败一律在连接数据库之前退出（`validate` 完全不连库）；
- 连接参数与 Flask 一致（PGHOST/PGUSER/...），不打印任何密码或连接串；
- 每次写操作写入审计日志（user_id 为空，detail.source = "cli"）；
- 新表由后端启动时的增量迁移创建：先部署后端，再执行本脚本。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

SEED_DIR = Path(__file__).resolve().parent / "templates_seed"


def build_app():
    """与 admin_plans.py 一致的最小 Flask：只连库，不注册路由、不起 worker。"""
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


def _check(path: str) -> Any:
    """读取并校验模板文件；有错误时打印全部错误并退出（不连库）。"""
    from doc_templates.schema import validate_template

    data = _load_file(path)
    _, errors = validate_template(data)
    if errors:
        _out(f"{path}: 校验失败，共 {len(errors)} 处错误")
        for err in errors:
            _out(f"  {err['path']}: {err['message']}")
        raise SystemExit(2)
    return data


def _confirm(question: str, assume_yes: bool) -> None:
    if assume_yes:
        return
    answer = input(f"{question} [y/N] ").strip().lower()
    if answer not in ("y", "yes"):
        raise SystemExit("已取消，未写入任何数据")


def _summary(data: dict) -> str:
    groups = data.get("groups") or []
    items = sum(len(g.get("items") or []) for g in groups)
    return f"code={data.get('code')} name={data.get('name')!r} groups={len(groups)} items={items}"


def _scope(tenant_id: int | None) -> str:
    return "system" if tenant_id is None else f"tenant#{tenant_id}"


# ---- 子命令（validate 之外都在 app_context 中执行） ----


def cmd_validate(args) -> int:
    data = _check(args.file)
    _out(f"{args.file}: 校验通过（{_summary(data)}）")
    return 0


def cmd_list(args) -> int:
    from doc_templates import repository as repo

    rows = repo.list_templates(
        tenant_id=args.tenant_id, system_only=args.system, include_deleted=args.include_deleted
    )
    if not rows:
        _out("没有模板")
        return 0
    _out(f"模板 {len(rows)} 个：")
    for tpl in rows:
        ver = repo.current_version(tpl)
        deleted = " DELETED" if tpl.deleted_at else ""
        updated = tpl.updated_at.isoformat(timespec="seconds") if tpl.updated_at else "-"
        _out(
            f"  #{tpl.id} {tpl.code} {tpl.name!r} scope={_scope(tpl.tenant_id)} status={tpl.status}{deleted}"
            f" version={ver.version if ver else '-'} updated_at={updated}"
        )
    return 0


def _get(template_id: int, *, include_deleted: bool = False):
    from doc_templates import repository as repo

    tpl = repo.get_template(template_id, include_deleted=include_deleted)
    if tpl is None:
        raise SystemExit(f"模板 {template_id} 不存在")
    return tpl


def cmd_show(args) -> int:
    from doc_templates import repository as repo

    tpl = _get(args.id, include_deleted=True)
    ver = repo.get_version(tpl, args.version) if args.version else repo.current_version(tpl)
    if ver is None:
        raise SystemExit(f"模板 {args.id} 没有版本 {args.version}")
    payload = {
        "id": tpl.id, "scope": _scope(tpl.tenant_id), "status": tpl.status,
        "deleted": tpl.deleted_at is not None, "version": ver.version,
        "template_version_id": ver.id, "content_hash": ver.content_hash,
        "template": repo.template_file(tpl, ver),
    }
    _out(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_export(args) -> int:
    from doc_templates import repository as repo

    tpl = _get(args.id)
    ver = repo.current_version(tpl)
    if ver is None:
        raise SystemExit(f"模板 {args.id} 没有当前版本")
    _out(json.dumps(repo.template_file(tpl, ver), ensure_ascii=False, indent=2))
    return 0


def _import_one(data: dict, tenant_id: int | None, dry_run: bool) -> dict:
    from doc_templates import repository as repo

    try:
        return repo.import_template(data, tenant_id=tenant_id, dry_run=dry_run, source="cli")
    except ValueError as exc:  # 租户不存在等
        raise SystemExit(str(exc)) from None


def _report(path: str, res: dict) -> None:
    prefix = "[dry-run] " if res.get("dry_run") else ""
    _out(
        f"{prefix}{path}: {res['action']} code={res['code']} scope={_scope(res['tenant_id'])}"
        f" template_id={res.get('template_id') or '-'} version={res.get('version')}"
    )


def cmd_import(args) -> int:
    from extensions import db

    data = _check(args.file)  # 先校验，失败不写库
    plan = _import_one(data, args.tenant_id, dry_run=True)
    _report(args.file, plan)
    db.session.rollback()
    if args.dry_run or plan["action"] == "unchanged":
        return 0
    _confirm(f"确认在 {_scope(args.tenant_id)} 作用域{plan['action']} {data['code']}？", args.yes)
    res = _import_one(data, args.tenant_id, dry_run=False)
    db.session.commit()
    _report(args.file, res)
    return 0


def cmd_seed(args) -> int:
    from extensions import db

    files = sorted(SEED_DIR.glob("*.json"))
    if not files:
        raise SystemExit(f"{SEED_DIR} 下没有模板文件")
    datas = [(str(f.relative_to(SEED_DIR.parent)), _check(str(f))) for f in files]  # 全部校验通过才继续
    plans = [(p, _import_one(d, None, dry_run=True)) for p, d in datas]
    db.session.rollback()
    for path, plan in plans:
        _report(path, plan)
    pending = [p for (p, plan) in plans if plan["action"] != "unchanged"]
    if args.dry_run or not pending:
        if not pending:
            _out("系统模板均已是最新，无需写入")
        return 0
    _confirm(f"确认以系统作用域写入 {len(pending)} 个模板？", args.yes)
    for path, data in datas:
        res = _import_one(data, None, dry_run=False)
        if res["action"] != "unchanged":
            _report(path, res)
    db.session.commit()
    return 0


def _status_cmd(action: str) -> Callable:
    def run(args) -> int:
        from doc_templates import repository as repo
        from extensions import db

        tpl = _get(args.id)
        label = f"#{tpl.id} {tpl.code} scope={_scope(tpl.tenant_id)} status={tpl.status}"
        if action == "delete":
            _confirm(f"确认软删除模板 {label}？已有映射仍可读取", args.yes)
            repo.soft_delete(tpl.id, source="cli")
        else:
            target = repo.ENABLED if action == "enable" else repo.DISABLED
            if tpl.status == target:
                _out(f"模板 {label} 无需变更")
                return 0
            _confirm(f"确认将模板 {label} 改为 {target}？", args.yes)
            repo.set_status(tpl.id, target, source="cli")
        db.session.commit()
        _out(f"已{ {'enable': '启用', 'disable': '停用', 'delete': '删除'}[action] }模板 #{tpl.id}")
        return 0

    return run


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SaiFlow 单据模板后台维护")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list", help="列出模板")
    scope = p.add_mutually_exclusive_group()
    scope.add_argument("--tenant-id", type=int, default=None)
    scope.add_argument("--system", action="store_true")
    p.add_argument("--include-deleted", action="store_true")
    p.set_defaults(handler=cmd_list)

    p = sub.add_parser("show", help="输出模板 JSON（含元数据）")
    p.add_argument("--id", type=int, required=True)
    p.add_argument("--version", type=int, default=None)
    p.set_defaults(handler=cmd_show)

    p = sub.add_parser("validate", help="只校验模板文件，不连接数据库")
    p.add_argument("--file", required=True)
    p.set_defaults(handler=cmd_validate, needs_db=False)

    p = sub.add_parser("import", help="按 (作用域, code) 创建或升版模板")
    p.add_argument("--file", required=True)
    p.add_argument("--tenant-id", type=int, default=None, help="缺省为系统模板")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_import)

    p = sub.add_parser("export", help="把当前版本输出为模板文件 JSON")
    p.add_argument("--id", type=int, required=True)
    p.set_defaults(handler=cmd_export)

    for action, text in (("enable", "启用"), ("disable", "停用"), ("delete", "软删除")):
        p = sub.add_parser(action, help=f"{text}模板")
        p.add_argument("--id", type=int, required=True)
        p.add_argument("--yes", action="store_true")
        p.set_defaults(handler=_status_cmd(action))

    p = sub.add_parser("seed", help="以系统作用域导入 templates_seed/*.json（幂等）")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_seed)
    return parser


def main(argv: list[str] | None = None, *, app=None) -> int:
    # 模板名称含泰文；Windows 控制台默认 GBK，统一按 UTF-8 输出，无法显示的字符替换
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass
    args = build_parser().parse_args(argv)
    if getattr(args, "needs_db", True) is False:
        return args.handler(args)
    if args.command in ("import",):
        _check(args.file)  # 连库之前先校验
    app = app or build_app()
    with app.app_context():
        return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
