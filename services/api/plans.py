"""套餐配置读取（FR-SYS-012/013/019；PRD v1.4 §20.1 / P15 定价页）。

套餐目录、月页额度、席位、价格展示文案（泰英双语）以及默认开通规则
（默认套餐、默认开通月数、审批默认续期月数）全部来自 `plans` 表，由
`manage_plans.py` 维护（PC 管理端后续接入）。读取方一律经本模块：

- 进程内短缓存（`CACHE_TTL_SECONDS`），改动在一个缓存周期内对所有租户
  （含存量订阅）生效——额度与名称实时按 `subscriptions.plan_code` 查表，不做快照；
- 读库使用独立只读连接，不污染请求会话的事务；
- 表为空或读库失败时退回 `plans_seed.json`（与首次建表时导入的种子同一份），
  保证计量与门禁永远有可用目录；
- 停用（DISABLED）的套餐不在目录展示、不可申请，但存量订阅仍按其配置计量。

支付仍完全线下：无在线下单、无回调、无自动续费。
"""
from __future__ import annotations

import copy
import json
import logging
import re
import time

from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SEED_PATH = Path(__file__).resolve().parent / "plans_seed.json"

LANGUAGES = ("en", "th")
STATUSES = ("ENABLED", "DISABLED")
THEMES = ("DEFAULT", "DARK")
MONTHS_MIN, MONTHS_MAX = 1, 120
CACHE_TTL_SECONDS = 60
_FAILURE_TTL_SECONDS = 10

# 对外（GET /plans）暴露的字段；其余为后台规则字段
PUBLIC_FIELDS = (
    "code", "name", "price", "quota_pages_per_month", "seats", "features", "theme", "is_default", "i18n",
)
# plans 表与配置文件共用的字段（文件格式即表的列）
CONFIG_FIELDS = (
    "code", "sort_order", "status", "is_default", "trial_months", "approved_period_months", "theme",
    "monthly_thb", "yearly_thb", "quota_pages_per_month", "seats", "name", "price_display", "features",
)

_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")
_NAME_MAX, _PRICE_MAX, _FEATURE_MAX, _FEATURES_MAX = 64, 128, 128, 10


class PlanConfigError(ValueError):
    """配置校验失败；errors 为 [{path, message}]，全部列出便于一次改完。"""

    def __init__(self, errors: list[dict]):
        super().__init__("; ".join(f"{e['path']}: {e['message']}" for e in errors))
        self.errors = errors


# ---- 校验（CLI 导入用，严格） ----


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _check_text_map(value: Any, path: str, limit: int, errors: list[dict]) -> None:
    if not isinstance(value, dict):
        errors.append({"path": path, "message": "必须是 {en, th} 对象"})
        return
    for lang in LANGUAGES:
        text = value.get(lang)
        if not isinstance(text, str) or not text.strip():
            errors.append({"path": f"{path}.{lang}", "message": "必填非空字符串"})
        elif len(text) > limit:
            errors.append({"path": f"{path}.{lang}", "message": f"不超过 {limit} 个字符"})
    extra = sorted(set(value) - set(LANGUAGES))
    if extra:
        errors.append({"path": path, "message": f"不支持的语言 {extra}（只允许 en / th）"})


def _check_features(value: Any, path: str, errors: list[dict]) -> None:
    if not isinstance(value, dict):
        errors.append({"path": path, "message": "必须是 {en: [...], th: [...]} 对象"})
        return
    for lang in LANGUAGES:
        items = value.get(lang)
        if not isinstance(items, list):
            errors.append({"path": f"{path}.{lang}", "message": "必须是字符串数组"})
            continue
        if len(items) > _FEATURES_MAX:
            errors.append({"path": f"{path}.{lang}", "message": f"最多 {_FEATURES_MAX} 条"})
        for i, item in enumerate(items):
            if not isinstance(item, str) or not item.strip() or len(item) > _FEATURE_MAX:
                errors.append({"path": f"{path}.{lang}[{i}]", "message": f"必须是 1~{_FEATURE_MAX} 字符的字符串"})
    extra = sorted(set(value) - set(LANGUAGES))
    if extra:
        errors.append({"path": path, "message": f"不支持的语言 {extra}（只允许 en / th）"})
    if isinstance(value.get("en"), list) and isinstance(value.get("th"), list) and (
        len(value["en"]) != len(value["th"])
    ):
        errors.append({"path": path, "message": "en 与 th 的条数必须一致"})


def validate_plan(raw: Any, path: str = "plan") -> tuple[dict | None, list[dict]]:
    """校验单个套餐配置；返回 (规范化配置, 错误列表)。"""
    errors: list[dict] = []
    if not isinstance(raw, dict):
        return None, [{"path": path, "message": "必须是对象"}]
    unknown = sorted(set(raw) - set(CONFIG_FIELDS))
    if unknown:
        errors.append({"path": path, "message": f"未知字段 {unknown}"})
    missing = [f for f in CONFIG_FIELDS if f not in raw]
    if missing:
        errors.append({"path": path, "message": f"缺少字段 {missing}"})

    code = raw.get("code")
    if not isinstance(code, str) or not _CODE_RE.match(code):
        errors.append({"path": f"{path}.code", "message": "2~32 位大写字母/数字/下划线，字母开头"})
    if "sort_order" in raw and not _is_int(raw["sort_order"]):
        errors.append({"path": f"{path}.sort_order", "message": "必须是整数"})
    if "status" in raw and raw["status"] not in STATUSES:
        errors.append({"path": f"{path}.status", "message": f"只能是 {list(STATUSES)}"})
    if "theme" in raw and raw["theme"] not in THEMES:
        errors.append({"path": f"{path}.theme", "message": f"只能是 {list(THEMES)}"})
    if "is_default" in raw and not isinstance(raw["is_default"], bool):
        errors.append({"path": f"{path}.is_default", "message": "必须是 true / false"})
    for field in ("trial_months", "approved_period_months"):
        if field in raw and not (_is_int(raw[field]) and MONTHS_MIN <= raw[field] <= MONTHS_MAX):
            errors.append({"path": f"{path}.{field}", "message": f"必须是 {MONTHS_MIN}~{MONTHS_MAX} 的整数"})
    for field in ("monthly_thb", "yearly_thb"):
        if field in raw and raw[field] is not None and not (_is_int(raw[field]) and raw[field] >= 0):
            errors.append({"path": f"{path}.{field}", "message": "必须是 ≥0 的整数或 null（面议）"})
    if "quota_pages_per_month" in raw and not (
        _is_int(raw["quota_pages_per_month"]) and raw["quota_pages_per_month"] >= 1
    ):
        errors.append({"path": f"{path}.quota_pages_per_month", "message": "必须是 ≥1 的整数"})
    if "seats" in raw and not (_is_int(raw["seats"]) and raw["seats"] >= 1):
        errors.append({"path": f"{path}.seats", "message": "必须是 ≥1 的整数"})
    if "name" in raw:
        _check_text_map(raw["name"], f"{path}.name", _NAME_MAX, errors)
    if "price_display" in raw:
        _check_text_map(raw["price_display"], f"{path}.price_display", _PRICE_MAX, errors)
    if "features" in raw:
        _check_features(raw["features"], f"{path}.features", errors)
    if errors:
        return None, errors
    config = {field: copy.deepcopy(raw[field]) for field in CONFIG_FIELDS}
    for key in ("name", "price_display"):
        config[key] = {lang: config[key][lang].strip() for lang in LANGUAGES}
    config["features"] = {lang: [s.strip() for s in config["features"][lang]] for lang in LANGUAGES}
    return config, []


def validate_catalog(items: Any) -> tuple[list[dict], list[dict]]:
    """校验完整目录：逐条校验 + code/sort_order 唯一 + 启用套餐中恰好一个默认套餐。"""
    if not isinstance(items, list) or not items:
        return [], [{"path": "plans", "message": "必须是非空数组"}]
    configs: list[dict] = []
    errors: list[dict] = []
    for i, raw in enumerate(items):
        config, errs = validate_plan(raw, f"plans[{i}]")
        errors.extend(errs)
        if config:
            configs.append(config)
    if errors:
        return [], errors
    for field in ("code", "sort_order"):
        seen: dict = {}
        for i, config in enumerate(configs):
            if config[field] in seen:
                errors.append({"path": f"plans[{i}].{field}", "message": f"与 plans[{seen[config[field]]}] 重复"})
            seen.setdefault(config[field], i)
    defaults = [c["code"] for c in configs if c["is_default"]]
    if len(defaults) != 1:
        errors.append({"path": "plans", "message": f"必须恰好一个 is_default=true，当前 {defaults or '无'}"})
    elif next(c for c in configs if c["is_default"])["status"] != "ENABLED":
        errors.append({"path": "plans", "message": f"默认套餐 {defaults[0]} 必须是 ENABLED"})
    return (configs if not errors else []), errors


def parse_file_payload(data: Any) -> list[Any]:
    """配置文件格式 {version: 1, plans: [...]}；也接受直接给数组。"""
    if isinstance(data, dict) and "plans" in data:
        return data["plans"]
    return data


def load_seed() -> list[dict]:
    """读取并校验内置种子；种子不合法属于发布事故，直接抛出。"""
    with open(SEED_PATH, encoding="utf-8") as fh:
        configs, errors = validate_catalog(parse_file_payload(json.load(fh)))
    if errors:
        raise PlanConfigError(errors)
    return configs


# ---- 读取（宽容：库里手工改坏的语言缺项退回英文） ----


def _text_map(value: Any, fallback: str) -> dict:
    value = value if isinstance(value, dict) else {}
    en = value.get("en") if isinstance(value.get("en"), str) and value.get("en") else fallback
    return {lang: (value.get(lang) if isinstance(value.get(lang), str) and value.get(lang) else en)
            for lang in LANGUAGES}


def _feature_map(value: Any) -> dict:
    value = value if isinstance(value, dict) else {}
    en = [s for s in value.get("en") or [] if isinstance(s, str)]
    return {lang: ([s for s in value.get(lang) or [] if isinstance(s, str)] or en) for lang in LANGUAGES}


def _view(record: dict) -> dict:
    """配置记录 → 运行期套餐视图（兼容旧 PLAN_CATALOG 字段 + i18n/theme + 规则字段）。"""
    code = record["code"]
    name = _text_map(record.get("name"), code.title())
    price = _text_map(record.get("price_display"), "Contact us")
    features = _feature_map(record.get("features"))

    def months(key: str, default: int) -> int:
        value = record.get(key)
        return value if _is_int(value) and MONTHS_MIN <= value <= MONTHS_MAX else default

    return {
        "code": code,
        "name": name["en"],
        "price": {
            "monthly_thb": record.get("monthly_thb"),
            "yearly_thb": record.get("yearly_thb"),
            "display": price["en"],
        },
        "quota_pages_per_month": int(record.get("quota_pages_per_month") or 0),
        "seats": int(record.get("seats") or 1),
        "features": list(features["en"]),
        "theme": record.get("theme") if record.get("theme") in THEMES else "DEFAULT",
        "i18n": {
            lang: {"name": name[lang], "price_display": price[lang], "features": list(features[lang])}
            for lang in LANGUAGES
        },
        "sort_order": int(record.get("sort_order") or 0),
        "status": record.get("status") if record.get("status") in STATUSES else "ENABLED",
        "is_default": bool(record.get("is_default")),
        "trial_months": months("trial_months", 1),
        "approved_period_months": months("approved_period_months", 12),
    }


def _load_rows() -> list[dict]:
    """用独立连接只读查询 plans 表（不参与、也不会中止请求会话的事务）。"""
    from sqlalchemy import select

    from extensions import db
    from models import Plan

    table = Plan.__table__
    with db.engine.connect() as conn:
        rows = conn.execute(select(*[table.c[f] for f in CONFIG_FIELDS])).mappings().all()
    return [dict(row) for row in rows]


_cache: tuple[float, list[dict]] | None = None


def invalidate() -> None:
    """清空进程内缓存（CLI 写库后、测试间调用）。"""
    global _cache
    _cache = None


def _all() -> list[dict]:
    global _cache
    now = time.monotonic()
    cached = _cache
    if cached is not None and cached[0] > now:
        return cached[1]
    ttl = CACHE_TTL_SECONDS
    try:
        records = _load_rows()
    except Exception:  # noqa: BLE001 - 读库失败不能让计量与门禁失效
        logger.warning("读取 plans 表失败，暂用内置种子目录", exc_info=True)
        records, ttl = [], _FAILURE_TTL_SECONDS
    if not records:
        records = load_seed()
    plans = sorted((_view(r) for r in records), key=lambda p: (p["sort_order"], p["code"]))
    _cache = (now + ttl, plans)
    return plans


# ---- 对外接口 ----


def all_plans() -> list[dict]:
    """全部套餐（含停用），按档位升序。"""
    return copy.deepcopy(_all())


def catalog() -> list[dict]:
    """目录：仅启用套餐，按档位升序。"""
    return [copy.deepcopy(p) for p in _all() if p["status"] == "ENABLED"]


def public_view(plan: dict) -> dict:
    return {field: copy.deepcopy(plan[field]) for field in PUBLIC_FIELDS}


def find_plan(code: str | None) -> dict | None:
    """按 code 查（含停用）；不存在返回 None。"""
    return next((copy.deepcopy(p) for p in _all() if p["code"] == code), None)


def default_plan() -> dict:
    """默认开通套餐：启用中 is_default 的那个；配置缺失时退回第一个启用（再退回第一个）套餐。"""
    plans = _all()
    enabled = [p for p in plans if p["status"] == "ENABLED"]
    chosen = next((p for p in enabled if p["is_default"]), None)
    if chosen is None:
        logger.warning("plans 中没有启用的默认套餐，退回档位最低的启用套餐")
        chosen = (enabled or plans)[0]
    return copy.deepcopy(chosen)


def get_plan(code: str | None) -> dict:
    """存量订阅引用的套餐；code 未知（不应发生：套餐只停用不删除）时按默认套餐计量。"""
    plan = find_plan(code)
    if plan is None:
        logger.warning("套餐 %r 不在配置中，按默认套餐计量", code)
        return default_plan()
    return plan


def plan_rank(code: str | None) -> int:
    """档位序（sort_order）；未知 code 为 -1。"""
    plan = next((p for p in _all() if p["code"] == code), None)
    return plan["sort_order"] if plan else -1


def plan_name(code: str | None, language: str = "en") -> str:
    plan = get_plan(code)
    lang = language if language in LANGUAGES else "en"
    return plan["i18n"][lang]["name"]


def approved_period_months(code: str | None) -> int:
    """人工审批未写有效期时的默认续期月数（按申请的套餐取）。"""
    return get_plan(code)["approved_period_months"]


# ---- 写入（启动自举与 CLI 共用） ----


def apply_config(row, config: dict) -> list[str]:
    """把规范化配置写到 ORM 行；返回发生变化的字段（code 不可改）。"""
    changed = []
    for field in CONFIG_FIELDS:
        if field == "code":
            continue
        if getattr(row, field, None) != config[field]:
            setattr(row, field, copy.deepcopy(config[field]))
            changed.append(field)
    return changed


def seed_if_empty() -> int:
    """plans 表为空时导入内置种子（多实例并发启动由 code 唯一约束兜住）；返回写入条数。"""
    from sqlalchemy.exc import IntegrityError

    from extensions import db
    from models import Plan

    if db.session.query(Plan.id).first() is not None:
        return 0
    configs = load_seed()
    for config in configs:
        row = Plan(code=config["code"])
        apply_config(row, config)
        db.session.add(row)
    try:
        db.session.commit()
    except IntegrityError:  # 另一实例已导入
        db.session.rollback()
        return 0
    invalidate()
    logger.info("plans 表为空，已导入内置种子 %d 个套餐", len(configs))
    return len(configs)
