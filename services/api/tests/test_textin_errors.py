"""textin.errors 的纯单元测试：error code 分类常量 + DocFlow 错误体解析 + GBK fallback。

对应 task 1.2 的验证：
- 错误响应解析用 `msg` 字段（不再是 `message`）；缺失时退到空串。
- `parse_docflow_error` 拒绝非 dict 入参（TypeError）。
- 新增分类常量：`DOCFLOW_RECOGNITION_FAILED` / `DOCFLOW_UNEXPECTED_STATUS` / `OCR_VENDOR_UNAVAILABLE`。
- GBK / gb2312 字节 fallback，覆盖 `code=200` / `429` / `400` / `-1` + gb2312 文本四种响应。
- TextInAPIError 形状从 `message` 字段改为 `msg`，OcrHTTPError 形状不变。
"""

from __future__ import annotations

import pytest

from textin.errors import (
    DOCFLOW_RECOGNITION_FAILED,
    DOCFLOW_UNEXPECTED_STATUS,
    OCR_VENDOR_UNAVAILABLE,
    OcrHTTPError,
    TextInAPIError,
    decode_vendor_body,
    parse_docflow_error,
)


# --- error code 分类常量 --------------------------------------------------

def test_vendor_error_code_constants_have_expected_values() -> None:
    """公开常量值稳定（routes / i18n / audit 按字面值引用）。"""
    assert DOCFLOW_RECOGNITION_FAILED == "DOCFLOW_RECOGNITION_FAILED"
    assert DOCFLOW_UNEXPECTED_STATUS == "DOCFLOW_UNEXPECTED_STATUS"
    assert OCR_VENDOR_UNAVAILABLE == "OCR_VENDOR_UNAVAILABLE"


def test_vendor_error_code_constants_are_distinct_strings() -> None:
    """三个分类不能重名，否则 route 映射时无法区分。"""
    constants = {
        DOCFLOW_RECOGNITION_FAILED,
        DOCFLOW_UNEXPECTED_STATUS,
        OCR_VENDOR_UNAVAILABLE,
    }
    assert len(constants) == 3


# --- parse_docflow_error：msg 字段语义 --------------------------------------

def test_parse_docflow_error_reads_msg_field() -> None:
    """DocFlow 错误体用 `msg`（不再是 `message`）；正常读到 code + msg。"""
    err = parse_docflow_error({"code": 429, "msg": "rate limit"})
    assert err.code == 429
    assert err.msg == "rate limit"
    assert isinstance(err, TextInAPIError)


def test_parse_docflow_error_payload_preserved_on_exception() -> None:
    """异常对象要带原始 payload（adapter 用于把 failure_causes 写进 error_message）。"""
    payload = {"code": 200, "msg": "x", "failure_causes": [{"code": "x", "msg": "y"}]}
    err = parse_docflow_error(payload)
    assert err.payload == payload


def test_parse_docflow_error_does_not_read_message_field() -> None:
    """只读 `msg`；payload 含 `message` 时不要被误读（避免与 DocFlow 混淆）。"""
    err = parse_docflow_error(
        {"code": -1, "message": "legacy only", "msg": "new msg"}
    )
    assert err.msg == "new msg"


def test_parse_docflow_error_missing_msg_returns_empty_string() -> None:
    """`msg` 字段缺失时 msg 为空串；不要回退到 `message`。"""
    err = parse_docflow_error({"code": -1, "message": "old field"})
    assert err.msg == ""


def test_parse_docflow_error_blank_msg_kept() -> None:
    """`msg` 为空字符串时保留为空（不要替换成 placeholder）。"""
    err = parse_docflow_error({"code": 500, "msg": ""})
    assert err.msg == ""


def test_parse_docflow_error_msg_missing_field_returns_empty() -> None:
    """`msg` 字段缺失时为 `""`，code 走默认 -1。"""
    err = parse_docflow_error({"x": 1})
    assert err.code == -1
    assert err.msg == ""


def test_parse_docflow_error_non_string_msg_coerced_to_empty() -> None:
    """`msg` 字段非 str 类型（vendor 偶发 bug）时不要崩，强制为 `""`。"""
    err = parse_docflow_error({"code": 1, "msg": 12345})
    assert err.msg == ""


def test_parse_docflow_error_requires_dict_payload() -> None:
    """非 dict 入参显式 TypeError（防止 None / str 静默吞错）。"""
    for bad in (None, "string", 123, ["list"]):
        with pytest.raises(TypeError):
            parse_docflow_error(bad)  # type: ignore[arg-type]


# --- 4 档 code 覆盖（200 / 429 / 400 / -1）-------------------------------

@pytest.mark.parametrize(
    "code",
    [200, 400, 429, -1],
)
def test_parse_docflow_error_preserves_code_in_range(code: int) -> None:
    """code ∈ {200, 400, 429, -1} 都能解包：code 透传、msg 来自 `msg` 字段。"""
    payload = {"code": code, "msg": f"vendor msg for code {code}"}
    err = parse_docflow_error(payload)
    assert err.code == code
    assert err.msg == f"vendor msg for code {code}"


def test_parse_docflow_error_code_200_path_keeps_recognition_signaling() -> None:
    """code=200 在 errors 层不解 recognition_status；下游 adapter 负责判定。
    本测试仅保证 errors 解包不丢字段，方便 adapter 后续读 result.files[*].recognition_status。"""
    err = parse_docflow_error(
        {"code": 200, "msg": "", "result": {"files": [{"recognition_status": 2}]}}
    )
    assert err.code == 200
    assert err.msg == ""
    assert err.payload["result"]["files"][0]["recognition_status"] == 2


# --- GBK / gb2312 fallback ------------------------------------------------

def test_decode_vendor_body_utf8_happy_path() -> None:
    """UTF-8 字节直接解出。"""
    payload = '{"code": 200, "msg": "你好"}'.encode("utf-8")
    assert decode_vendor_body(payload) == '{"code": 200, "msg": "你好"}'


def test_decode_vendor_body_gbk_fallback() -> None:
    """GBK 编码字节（vendor 前置代理转码的退化场景）：fallback 解码成功。"""
    raw = '{"msg": "中文"}'.encode("gbk")
    out = decode_vendor_body(raw)
    assert "中文" in out
    assert '"msg"' in out


def test_decode_vendor_body_gb2312_fallback_for_text_body() -> None:
    """task 1.2 明确要求覆盖 gb2312 文本响应字节。"""
    raw = '{"msg": "发票"}'.encode("gb2312")
    out = decode_vendor_body(raw)
    assert "发票" in out


def test_decode_vendor_body_invalid_bytes_returns_replacement_string() -> None:
    """既不是 UTF-8 也不是 GBK/gb2312 的字节：lossy decode 兜底，绝不抛异常。"""
    raw = bytes([0xFF, 0xFE, 0xFD])
    out = decode_vendor_body(raw)
    assert isinstance(out, str)
    assert len(out) >= 1


def test_decode_vendor_body_empty_bytes_returns_empty_string() -> None:
    """空 body 兜底（代理返回空响应时不崩）。"""
    assert decode_vendor_body(b"") == ""


# --- TextInAPIError / OcrHTTPError 形状回归 --------------------------------

def test_textinapierror_msg_replaces_legacy_message_attribute() -> None:
    """TextInAPIError 不再有 `.message` 属性；统一用 `.msg`，杜绝历史语义混淆。"""
    err = TextInAPIError(code=429, msg="rate limit", payload={"code": 429, "msg": "rate limit"})
    assert err.code == 429
    assert err.msg == "rate limit"
    assert err.payload == {"code": 429, "msg": "rate limit"}
    assert not hasattr(err, "message")


def test_textinapierror_supports_positional_construction() -> None:
    """旧调用方 `TextInAPIError(code, message)` 仍能工作（不再 message 必须为 kw）。"""
    err = TextInAPIError(429, "rate limit")
    assert err.code == 429
    assert err.msg == "rate limit"
    assert err.payload == {}


def test_textinapierror_blank_msg_coerced_to_empty_string() -> None:
    """None / 缺失 msg 不让 .msg 变 None（防止下游 `.lower()` 崩）。"""
    err = TextInAPIError(code=1, msg=None)  # type: ignore[arg-type]
    assert err.msg == ""


def test_ocrhttperror_shape_unchanged() -> None:
    """OcrHTTPError 是 route 用的网关错误，本次不破形状（status / code / msg / data）。"""
    err = OcrHTTPError(
        status=400,
        code=DOCFLOW_RECOGNITION_FAILED,
        msg="oops",
        data={"foo": 1},
    )
    assert err.status == 400
    assert err.code == DOCFLOW_RECOGNITION_FAILED
    assert err.msg == "oops"
    assert err.data == {"foo": 1}
