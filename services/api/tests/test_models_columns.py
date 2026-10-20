"""models.OcrJob 在 DocFlow 迁移期间新增的 4 列：纯结构测试（不连数据库）。

对应 task 3.1 的验证：
- `vendor_task_id` / `vendor_batch_number` / `vendor_category`：String，可空。
- `recognition_status`：Integer，可空。
- 4 列都在 `OcrJob.__table__.columns` 中存在。
- 默认值都是 None（不强制业务字段必须有值；旧记录迁移安全）。
"""

from __future__ import annotations

from sqlalchemy import Integer

# 在模块顶层一次导入，避免 reload 引发的 SQLAlchemy 类重注册警告；
# SQLAlchemy declarative_base 在 sys.modules 里只注册一次，跨测试用例可复用。
import models

OcrJob = models.OcrJob


def _column(name: str):
    table = OcrJob.__table__
    assert name in table.columns, f"column {name} missing on OcrJob"
    return table.columns[name]


def test_vendor_task_id_column_exists_with_string_nullable() -> None:
    """vendor_task_id: String(64), nullable=True."""
    col = _column("vendor_task_id")
    assert col.nullable is True
    type_str = str(col.type)
    assert "VARCHAR" in type_str or "String" in type_str or "TEXT" in type_str


def test_vendor_batch_number_column_exists_with_string_nullable() -> None:
    """vendor_batch_number: String(64), nullable=True."""
    col = _column("vendor_batch_number")
    assert col.nullable is True
    type_str = str(col.type)
    assert "VARCHAR" in type_str or "String" in type_str or "TEXT" in type_str


def test_vendor_category_column_exists_with_string_nullable() -> None:
    """vendor_category: String(64), nullable=True。"""
    col = _column("vendor_category")
    assert col.nullable is True
    type_str = str(col.type)
    assert "VARCHAR" in type_str or "String" in type_str or "TEXT" in type_str


def test_recognition_status_column_exists_with_integer_nullable() -> None:
    """recognition_status: Integer, nullable=True（允许 0/1/2/.../20 + None）。"""
    col = _column("recognition_status")
    assert col.nullable is True
    assert isinstance(col.type, Integer)


def test_new_columns_have_no_server_default() -> None:
    """4 列都没有 server_default（不强制 DB 层默认值；Python 端默认 None）。"""
    for name in (
        "vendor_task_id",
        "vendor_batch_number",
        "vendor_category",
        "recognition_status",
    ):
        col = _column(name)
        assert col.server_default is None, f"column {name} should not have server_default"


def test_legacy_columns_remain_intact() -> None:
    """迁移不能偷偷改字段；旧字段（vendor_request_id / status / page_count / ...）还在。"""
    for legacy in (
        "id",
        "status",
        "vendor_request_id",
        "page_count",
        "table_count",
        "field_count",
        "duration_ms",
        "missing_pages",
        "review_status",
        "started_at",
        "finished_at",
    ):
        assert legacy in OcrJob.__table__.columns, f"legacy column {legacy} missing"


def test_recognition_status_accepts_docflow_enum_range() -> None:
    """recognition_status 列用通用 Integer（0..20 全 DocFlow enum 合法值 + None）。"""
    col_type = OcrJob.__table__.columns["recognition_status"].type
    assert isinstance(col_type, Integer), (
        f"recognition_status must be Integer, got {type(col_type).__name__}"
    )


def test_new_vendor_columns_documented_with_comments() -> None:
    """Schema 迁移要保留每一列的 comment（与 OpenSpec / 数据字典对齐）。"""
    for name in (
        "vendor_task_id",
        "vendor_batch_number",
        "vendor_category",
        "recognition_status",
    ):
        col = OcrJob.__table__.columns[name]
        assert col.comment, f"column {name} should have a comment"

