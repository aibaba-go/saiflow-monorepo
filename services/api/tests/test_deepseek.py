"""DeepSeek 客户端单测：请求形态、Markdown 代码块剥离、错误处理（MockTransport，不触网）。"""

from __future__ import annotations

import json

import httpx
import pytest

import deepseek

CFG = {"DEEPSEEK_API_KEY": "sk-test", "DEEPSEEK_BASE_URL": "https://api.deepseek.com/",
       "DEEPSEEK_MODEL": "deepseek-flash"}


def _transport(content: str, status: int = 200, captured: dict | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")
            captured["body"] = json.loads(request.content)
        if status != 200:
            return httpx.Response(status, text="err")
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    return httpx.MockTransport(handler)


def test_refine_request_shape_and_parse() -> None:
    captured: dict = {}
    out = deepseek.refine_json({"a": "泰铢"}, CFG, transport=_transport('{\n  "金额": 1\n}', captured=captured))
    assert out == {"金额": 1}
    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["auth"] == "Bearer sk-test"
    body = captured["body"]
    assert body["model"] == "deepseek-flash"
    assert "response_format" not in body
    user = body["messages"][-1]["content"]
    assert user.startswith(deepseek.REFINE_PROMPT)
    assert '{"a": "泰铢"}' in user


def test_refine_strips_markdown_fence() -> None:
    out = deepseek.refine_json({}, CFG, transport=_transport('```json\n{"x": [1, 2]}\n```'))
    assert out == {"x": [1, 2]}


@pytest.mark.parametrize("content,status", [("not json", 200), ("{}", 500)])
def test_refine_errors(content: str, status: int) -> None:
    with pytest.raises(deepseek.DeepSeekError):
        deepseek.refine_json({}, CFG, transport=_transport(content, status))
