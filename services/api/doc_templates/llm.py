"""模板映射的大模型调用封装（design D11）。

- 复用 DEEPSEEK_BASE_URL / DEEPSEEK_API_KEY / DEEPSEEK_MODEL；温度 0；不使用 response_format。
- 超时：连接 10 秒，读取 DEEPSEEK_TIMEOUT_SECONDS（默认 120 秒）。
- 每个阶段最多 2 次调用（首次 + 1 次重试）：网络 / 超时 / 429 / 5xx 或输出非法时重试，重试前等待 2 秒；
  输出非法时把上次输出与原因附在对话末尾请模型修复。
- 日志只记录调用次数、token 用量、耗时、模型与提示词版本，不记录单据内容。
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, TypeVar

import httpx

logger = logging.getLogger(__name__)

T = TypeVar("T")

MAX_CALLS_PER_STAGE = 2
RETRY_DELAY_SECONDS = 2.0

MATCH_FAILED = "MATCH_FAILED"
LLM_TIMEOUT = "LLM_TIMEOUT"
LLM_UNAVAILABLE = "LLM_UNAVAILABLE"
LLM_INVALID_OUTPUT = "LLM_INVALID_OUTPUT"
RAW_TOO_LARGE = "RAW_TOO_LARGE"
MAPPING_INTERRUPTED = "MAPPING_INTERRUPTED"
RAW_RESULT_MISSING = "RAW_RESULT_MISSING"


class MappingError(RuntimeError):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code
        self.message = message or code


class OutputInvalid(ValueError):
    """模型输出不合法（可修复重试）。"""


class _Transient(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class Usage:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    model: str = ""
    stages: list[str] = field(default_factory=list)


def parse_json(content: str) -> Any:
    """解析模型输出的 JSON；小数保留为字符串（parse_float=str），避免浮点漂移。"""
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0].strip()
    try:
        return json.loads(text, parse_float=str)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(text[start:end + 1], parse_float=str)
            except ValueError:
                pass
    raise OutputInvalid("output is not valid JSON")


class LlmClient:
    def __init__(
        self, config: Mapping[str, Any], *, transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.api_key = str(config.get("DEEPSEEK_API_KEY") or "")
        self.base_url = str(config.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")
        self.model = str(config.get("DEEPSEEK_MODEL") or "deepseek-flash")
        self.timeout = httpx.Timeout(float(config.get("DEEPSEEK_TIMEOUT_SECONDS") or 120), connect=10.0)
        self.transport = transport
        self.sleep = sleep
        self.usage = Usage(model=self.model)

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _chat(self, messages: list[dict]) -> str:
        body = {"model": self.model, "temperature": 0, "messages": messages}
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
                resp = client.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=body,
                )
        except httpx.TimeoutException as exc:
            raise _Transient(LLM_TIMEOUT, f"LLM timeout: {type(exc).__name__}") from exc
        except httpx.TransportError as exc:
            raise _Transient(LLM_UNAVAILABLE, f"LLM network error: {type(exc).__name__}") from exc
        finally:
            self.usage.calls += 1
        if resp.status_code == 429 or resp.status_code >= 500:
            raise _Transient(LLM_UNAVAILABLE, f"LLM HTTP {resp.status_code}")
        if resp.status_code != 200:
            raise MappingError(LLM_UNAVAILABLE, f"LLM HTTP {resp.status_code}")
        try:
            payload = resp.json()
            content = payload["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError):
            raise OutputInvalid("LLM response structure invalid") from None
        usage = payload.get("usage") if isinstance(payload, dict) else None
        if isinstance(usage, dict):
            self.usage.prompt_tokens += int(usage.get("prompt_tokens") or 0)
            self.usage.completion_tokens += int(usage.get("completion_tokens") or 0)
        return content

    def run_stage(
        self, stage: str, messages: list[dict], parse: Callable[[str], T], *, invalid_code: str,
    ) -> T:
        """执行一个阶段（匹配或转换）：最多 2 次调用，返回 parse 的结果。"""
        if not self.configured:
            raise MappingError(LLM_UNAVAILABLE, "LLM not configured")
        self.usage.stages.append(stage)
        convo = list(messages)
        started = time.monotonic()
        last_code, last_message = invalid_code, ""
        for attempt in range(MAX_CALLS_PER_STAGE):
            if attempt:
                self.sleep(RETRY_DELAY_SECONDS)
            content = None
            try:
                content = self._chat(convo)
                result = parse(content)
                logger.info(
                    "template llm stage=%s ok calls=%d prompt_tokens=%d completion_tokens=%d ms=%d model=%s",
                    stage, self.usage.calls, self.usage.prompt_tokens, self.usage.completion_tokens,
                    int((time.monotonic() - started) * 1000), self.model,
                )
                return result
            except _Transient as exc:
                last_code, last_message = exc.code, str(exc)
            except OutputInvalid as exc:
                last_code, last_message = invalid_code, str(exc)
                if content is not None:
                    convo = list(messages) + [
                        {"role": "assistant", "content": content[:20000]},
                        {"role": "user", "content": f"上次输出不合法：{exc}。请严格按要求只输出 JSON，不要任何解释。"},
                    ]
            logger.warning("template llm stage=%s attempt=%d failed code=%s", stage, attempt + 1, last_code)
        raise MappingError(last_code, last_message)
