"""DeepSeek（OpenAI 兼容 Chat Completions）：把 TextIn 抽取的 JSON 二次整理为易读结构。"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

import httpx

REFINE_PROMPT = (
    "请帮我结构化这个文件，结果以 JSON 形式返回（json需要格式化易于阅读，保持换行和缩进）"
)

# 不用 response_format=json_object：实测 deepseek-flash 会把它误当成要输出的字段（多出 "type": "json_object"）
SYSTEM_PROMPT = (
    "你是文档结构化助手。输入是 OCR 抽取得到的 JSON。"
    "请整理为结构清晰、易读的 JSON：按语义分组（如基本信息、买卖双方、明细表格、金额汇总），"
    "表格用对象数组表示；不得编造、遗漏或改动原始数值和文本。"
    "所有键名（key）一律使用英文 snake_case，禁止中文键名；值保持原文语言不变。"
    "只输出 JSON 本身，不要任何解释或 Markdown 代码块。"
)


class DeepSeekError(RuntimeError):
    pass


def is_configured(config: Mapping[str, Any]) -> bool:
    return bool(config.get("DEEPSEEK_API_KEY"))


def _parse_content(content: str) -> Any:
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0]
    try:
        # decimals stay text, never floats (ocr-scan-flow, Review Focus 4)
        return json.loads(text, parse_float=str)
    except ValueError as e:
        raise DeepSeekError(f"DeepSeek 返回的不是合法 JSON: {e}") from e


def refine_json(
    data: Any, config: Mapping[str, Any], *, transport: httpx.BaseTransport | None = None
) -> Any:
    base_url = str(config.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")
    body = {
        "model": config.get("DEEPSEEK_MODEL") or "deepseek-flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"{REFINE_PROMPT}\n\n{json.dumps(data, ensure_ascii=False)}",
            },
        ],
    }
    timeout = httpx.Timeout(float(config.get("DEEPSEEK_TIMEOUT_SECONDS") or 120), connect=10.0)
    with httpx.Client(timeout=timeout, transport=transport) as client:
        resp = client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {config['DEEPSEEK_API_KEY']}"},
            json=body,
        )
    if resp.status_code != 200:
        raise DeepSeekError(f"DeepSeek HTTP {resp.status_code}: {resp.text[:300]}")
    try:
        content = resp.json()["choices"][0]["message"]["content"] or ""
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise DeepSeekError(f"DeepSeek 响应结构异常: {e}") from e
    return _parse_content(content)
