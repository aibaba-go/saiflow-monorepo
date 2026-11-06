"""模板结构校验（design D2，FR-TEMPLATE-001）。

模板文件与版本快照使用同一 JSON 结构：
    {code, name, description, groups: [{key, name, description, items: [field | table]}]}

validate_template() 一次返回全部错误，每项为 {"path": "groups[1].items[0].columns[2].type", "message": ...}；
结构错误由 Pydantic 校验，跨项规则（唯一性、总数上限）单独检查后合并。
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

FIELD_TYPES = ("string", "integer", "decimal", "amount")
KEY_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"
CODE_PATTERN = r"^[a-z0-9][a-z0-9._-]{0,63}$"

MAX_GROUPS = 20
MAX_FIELDS_AND_COLUMNS = 200
MAX_TABLES = 10
MAX_NAME = 100
MAX_DESCRIPTION = 500
MAX_TEMPLATE_DESCRIPTION = 1000

Key = Annotated[str, StringConstraints(pattern=KEY_PATTERN)]
Code = Annotated[str, StringConstraints(pattern=CODE_PATTERN)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_DESCRIPTION)]
TemplateDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=MAX_TEMPLATE_DESCRIPTION)
]
# "date" is added in this repository (FR-OCR-016): stored as YYYY-MM-DD
FieldType = Literal["string", "integer", "decimal", "amount", "date"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Names(_Strict):
    """Display names per interface language (web-pc/line-mini en, th, zh); added in this
    repository, main had one combined "English / Thai" name. Absent → `name`."""

    en: Name | None = None
    th: Name | None = None
    zh: Name | None = None


class Column(_Strict):
    key: Key
    name: Name
    names: Names | None = None
    description: Description = ""
    type: FieldType = "string"
    required: bool = False


class FieldItem(_Strict):
    kind: Literal["field"]
    key: Key
    name: Name
    names: Names | None = None
    description: Description = ""
    type: FieldType = "string"
    required: bool = False


class TableItem(_Strict):
    kind: Literal["table"]
    key: Key
    name: Name
    names: Names | None = None
    description: Description = ""
    columns: list[Column] = Field(min_length=1)


Item = Annotated[FieldItem | TableItem, Field(discriminator="kind")]


class Group(_Strict):
    key: Key
    name: Name
    names: Names | None = None
    description: Description = ""
    items: list[Item] = Field(min_length=1)


class TemplateDef(_Strict):
    code: Code
    name: Name
    names: Names | None = None
    description: TemplateDescription = ""
    groups: list[Group] = Field(min_length=1, max_length=MAX_GROUPS)


class TemplateValidationError(ValueError):
    def __init__(self, errors: list[dict]) -> None:
        super().__init__(f"template invalid: {len(errors)} error(s)")
        self.errors = errors


def _path(loc: tuple) -> str:
    out = ""
    prev = None
    for part in loc:
        # 判别联合会在 loc 中插入标签（field / table），对用户无意义，去掉
        if isinstance(prev, int) and part in ("field", "table") and out.endswith("]"):
            prev = part
            continue
        if isinstance(part, int):
            out += f"[{part}]"
        else:
            out += f".{part}" if out else str(part)
        prev = part
    return out or "$"


def _semantic_errors(data: Any) -> list[dict]:
    """跨项规则；只在结构可读的部分检查，结构错误交给 Pydantic 报告。"""
    errors: list[dict] = []
    if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
        return errors
    seen_groups: set = set()
    total = 0
    tables = 0
    for gi, group in enumerate(data["groups"]):
        if not isinstance(group, dict):
            continue
        gkey = group.get("key")
        if isinstance(gkey, str):
            if gkey in seen_groups:
                errors.append(
                    {"path": f"groups[{gi}].key", "message": f"duplicate group key '{gkey}'"}
                )
            seen_groups.add(gkey)
        items = group.get("items")
        if not isinstance(items, list):
            continue
        seen_items: set = set()
        for ii, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            ikey = item.get("key")
            if isinstance(ikey, str):
                if ikey in seen_items:
                    errors.append(
                        {
                            "path": f"groups[{gi}].items[{ii}].key",
                            "message": f"duplicate item key '{ikey}' in group",
                        }
                    )
                seen_items.add(ikey)
            if item.get("kind") == "table":
                tables += 1
                columns = item.get("columns")
                if isinstance(columns, list):
                    total += len(columns)
                    seen_cols: set = set()
                    for ci, col in enumerate(columns):
                        ckey = col.get("key") if isinstance(col, dict) else None
                        if isinstance(ckey, str):
                            if ckey in seen_cols:
                                errors.append(
                                    {
                                        "path": f"groups[{gi}].items[{ii}].columns[{ci}].key",
                                        "message": f"duplicate column key '{ckey}' in table",
                                    }
                                )
                            seen_cols.add(ckey)
            else:
                total += 1
    if total > MAX_FIELDS_AND_COLUMNS:
        errors.append(
            {
                "path": "groups",
                "message": f"fields and columns total {total} exceeds {MAX_FIELDS_AND_COLUMNS}",
            }
        )
    if tables > MAX_TABLES:
        errors.append({"path": "groups", "message": f"tables total {tables} exceeds {MAX_TABLES}"})
    return errors


def validate_template(data: Any) -> tuple[TemplateDef | None, list[dict]]:
    """返回 (模型, 错误列表)；有任何错误时模型为 None。"""
    errors: list[dict] = []
    model: TemplateDef | None = None
    try:
        model = TemplateDef.model_validate(data)
    except ValidationError as exc:
        for err in exc.errors(include_url=False):
            errors.append({"path": _path(tuple(err["loc"])), "message": err["msg"]})
    errors.extend(_semantic_errors(data))
    if errors:
        return None, errors
    return model, []


def parse_template(data: Any) -> TemplateDef:
    model, errors = validate_template(data)
    if errors:
        raise TemplateValidationError(errors)
    assert model is not None
    return model


def canonical_groups(model: TemplateDef) -> list[dict]:
    """补齐缺省值后的 groups，作为版本快照与哈希输入。"""
    return [g.model_dump(mode="json") for g in model.groups]


def iter_fields(groups: list[dict]):
    """遍历 (group, item)；item 为 field 或 table 字典。"""
    for group in groups or []:
        for item in group.get("items") or []:
            yield group, item


_KEY_RE = re.compile(KEY_PATTERN)


def is_valid_key(key: Any) -> bool:
    return isinstance(key, str) and bool(_KEY_RE.match(key))
