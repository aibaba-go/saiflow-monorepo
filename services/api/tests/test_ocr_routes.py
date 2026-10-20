"""routes/ocr 的 DocFlow 适配单测：覆盖 /ocr/capabilities + create_job 参数校验。

对应 task 4.3 的验证：
- /ocr/capabilities 返回 `vendor == "textin-docflow"` 且 `parse_modes == ["auto","scan","vlm"]`。
- create_job 接受 parser_parse_mode ∈ {auto, scan, vlm}。
- create_job 拒绝 parser_parse_mode ∈ {layout, article, garbage} 等旧 vendor 值。
- create_job 拒绝 legacy key（parse_mode / table / formula / rotate / layout / article / field_names）。
"""

from __future__ import annotations

import pytest
from flask import Flask

import errors as err_mod
from routes.ocr import (
    ALLOWED_PARSE_MODES,
    ALLOWED_PARSER_DPI,
    ALLOWED_PARSER_PARAMS,
    ALLOWED_TARGET_PROCESS,
    REJECTED_PARAM_KEYS,
    _validate_parser_params,
    ocr_bp,
)


# --- /ocr/capabilities --------------------------------------------------


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["ALLOWED_FILE_EXTENSIONS"] = [".pdf", ".png"]
    app.config["MAX_FILE_SIZE_BYTES"] = 20 * 1024 * 1024
    app.config["MAX_PAGES_PER_TASK"] = 50
    app.config["MAX_IMAGES_PER_TASK"] = 10
    app.config["MAX_IMAGES_TOTAL_BYTES"] = 20 * 1024 * 1024
    app.register_blueprint(ocr_bp, url_prefix="/api/v1")
    return app


def test_capabilities_returns_docflow_parse_modes(app: Flask) -> None:
    """/ocr/capabilities: parse_modes 现在是 [auto, scan, vlm]；vendor = textin-docflow。"""
    client = app.test_client()
    resp = client.get("/api/v1/ocr/capabilities")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["code"] == "OK"
    data = body["data"]
    assert data["vendor"] == "textin-docflow"
    assert data["features"]["parse_modes"] == ["auto", "scan", "vlm"]


def test_capabilities_omits_legacy_parse_modes(app: Flask) -> None:
    """旧 vendor 的 layout / article 必须从 capabilities 列表里消失。"""
    client = app.test_client()
    resp = client.get("/api/v1/ocr/capabilities")
    modes = resp.get_json()["data"]["features"]["parse_modes"]
    assert "layout" not in modes
    assert "article" not in modes


# --- _validate_parser_params 纯函数覆盖 -----------------------------------


def _expect_invalid_argument(params: dict) -> err_mod.ApiError:
    """Call the validator and assert it raises errors.ApiError; return the
    raised instance so callers can assert on field_errors if needed.
    """
    with pytest.raises(err_mod.ApiError) as exc_info:
        _validate_parser_params(params)
    return exc_info.value


def test_validate_accepts_documented_parse_mode_values() -> None:
    """parser_parse_mode = auto / scan / vlm：均接受。"""
    for mode in ("auto", "scan", "vlm"):
        _validate_parser_params({"parser_parse_mode": mode})  # 不抛


@pytest.mark.parametrize(
    "mode",
    ["layout", "article", "garbage", ""],
)
def test_validate_rejects_legacy_parse_modes(mode: str) -> None:
    """layout / article / 其他字符串 → 拒绝（迁移到 DocFlow 后这些值废弃）。"""
    err = _expect_invalid_argument({"parser_parse_mode": mode})
    assert err.code == "INVALID_ARGUMENT"
    assert err.field_errors[0]["field"] == "parser_parse_mode"


@pytest.mark.parametrize(
    "params",
    [
        {"parse_mode": "scan"},
        {"table": True},
        {"formula": True},
        {"rotate": False},
        {"layout": True},
        {"article": True},
        {"field_names": ["invoice_no"]},
    ],
)
def test_validate_rejects_legacy_param_keys(params: dict) -> None:
    """legacy 键：parse_mode / table / formula / rotate / layout / article / field_names → 拒绝。"""
    expected_field = next(iter(params.keys()))
    err = _expect_invalid_argument(params)
    assert err.code == "INVALID_ARGUMENT"
    fields = {fe["field"] for fe in err.field_errors}
    assert expected_field in fields


def test_validate_accepts_docflow_param_subset() -> None:
    """完整 DocFlow 子集（不含 page）→ 接受。"""
    params = {
        "parser_parse_mode": "vlm",
        "parser_formula_level": 1,
        "parser_crop_dewarp": True,
        "parser_dpi": 216,
        "parser_apply_merge": False,
        "category": "invoice",
        "batch_number": "BN-1",
        "target_process": "extract",
    }
    _validate_parser_params(params)  # 不抛


def test_validate_rejects_unknown_keys() -> None:
    """未在白名单里的键（含 page / page_count 已单独允许）→ 拒绝（防止调用方加无用字段）。"""
    err = _expect_invalid_argument({"parser_unknown_flag": "x"})
    assert err.field_errors[0]["field"] == "parser_unknown_flag"


@pytest.mark.parametrize("bad_dpi", [72, 300, 0, 100])
def test_validate_rejects_unsupported_dpi(bad_dpi: int) -> None:
    """parser_dpi 必须 ∈ {144, 216}；其他 → 拒绝。"""
    err = _expect_invalid_argument({"parser_dpi": bad_dpi})
    assert err.field_errors[0]["field"] == "parser_dpi"


@pytest.mark.parametrize("dpi", [144, 216])
def test_validate_accepts_supported_dpi(dpi: int) -> None:
    """parser_dpi = 144 / 216 → 接受。"""
    _validate_parser_params({"parser_dpi": dpi})


@pytest.mark.parametrize("bad", [2, -1, "high"])
def test_validate_rejects_unsupported_formula_level(bad: object) -> None:
    """parser_formula_level 必须 ∈ {0, 1}；其他 → 拒绝。"""
    err = _expect_invalid_argument({"parser_formula_level": bad})
    assert err.field_errors[0]["field"] == "parser_formula_level"


@pytest.mark.parametrize("bad", ["pretend", "classify-extract", ""])
def test_validate_rejects_unsupported_target_process(bad: str) -> None:
    """target_process 必须 ∈ {classify, extract}；其他 → 拒绝。"""
    err = _expect_invalid_argument({"target_process": bad})
    assert err.field_errors[0]["field"] == "target_process"


@pytest.mark.parametrize("bad", ["true", 1, 0])
def test_validate_rejects_non_bool_crop_dewarp(bad: object) -> None:
    """parser_crop_dewarp 必须是 bool；不是 → 拒绝（防止字符串 'true' 漏掉）。"""
    err = _expect_invalid_argument({"parser_crop_dewarp": bad})
    assert err.field_errors[0]["field"] == "parser_crop_dewarp"


def test_validate_rejects_blank_or_oversized_string_fields() -> None:
    """category / batch_number：空字符串 / 空白 / 超长 / 数字 → 拒绝。"""
    for field in ("category", "batch_number"):
        for value in ("", "   ", "x" * 200, 123):
            err = _expect_invalid_argument({field: value})
            assert err.field_errors[0]["field"] == field


def test_validate_keeps_page_and_page_count() -> None:
    """page / page_count 由 create_job 其它校验路径处理，_validate_parser_params 不动它们。"""
    _validate_parser_params({"page": 0, "page_count": 5})


def test_validate_accepts_empty_params_dict() -> None:
    """params 为空 → 接受（用户没有额外偏好，走 vendor 默认）。"""
    _validate_parser_params({})


# --- 常量元测试（防止误改白名单） -----------------------------------------


def test_allowed_parse_modes_constant() -> None:
    """ALLOWED_PARSE_MODES 字面值稳定（前端 / OpenAPI 文档按此引用）。"""
    assert ALLOWED_PARSE_MODES == frozenset({"auto", "scan", "vlm"})


def test_rejected_param_keys_constant_includes_legacy() -> None:
    """REJECTED_PARAM_KEYS 包含所有 legacy keys（防止误删，回归保护）。"""
    expected = {"parse_mode", "table", "formula", "rotate", "layout", "article", "field_names"}
    assert expected.issubset(REJECTED_PARAM_KEYS)


def test_allowed_parser_params_constant_includes_docflow_keys() -> None:
    """ALLOWED_PARSER_PARAMS 包含 DocFlow 全部白名单键（与 adapter 一致）。"""
    expected = {
        "parser_parse_mode",
        "parser_formula_level",
        "parser_crop_dewarp",
        "parser_dpi",
        "parser_apply_merge",
        "category",
        "batch_number",
        "target_process",
    }
    assert expected.issubset(ALLOWED_PARSER_PARAMS)


def test_target_process_and_dpi_constants_have_expected_values() -> None:
    """ALLOWED_TARGET_PROCESS / ALLOWED_PARSER_DPI 字面值稳定。"""
    assert ALLOWED_TARGET_PROCESS == frozenset({"classify", "extract"})
    assert ALLOWED_PARSER_DPI == frozenset({144, 216})
