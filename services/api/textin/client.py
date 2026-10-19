"""TextIn DocFlow sync upload client.

Reference: https://docs-docflow.textin.ai/api-reference/upload-file

- endpoint: POST https://docflow.textin.ai/api/app-api/sip/platform/v2/file/upload/sync
- auth headers: x-ti-app-id / x-ti-secret-code
- required query param: workspace_id
- optional query params: category, batch_number, parser_parse_mode
  (auto|scan|vlm), parser_formula_level, parser_crop_dewarp, parser_dpi
  (144|216), parser_apply_merge, target_process (classify|extract)
- request body: multipart/form-data, single field `file`
- success body: {"code": 200, "msg": "...", "result": {"files": [{...}]}}
- error body: {"code": 4xx, "msg": "..."} — the human-readable field is
  `msg`, NOT `message` (DocFlow renamed the legacy xparse field).

The legacy Chinese xparse / extract / prompt-mode paths have been removed; the
only API surface is `upload_file_sync` + `close`.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from textin.config import TextInSettings
from textin.errors import (
    TextInAPIError,
    decode_vendor_body,
    parse_docflow_error,
)

logger = logging.getLogger(__name__)


class TextInClient:
    """TextIn DocFlow sync upload client (Flask/WSGI compatible).

    Lifecycle is owned by extensions.init_textin: one instance per app.
    Tests can inject a custom `transport` (httpx.MockTransport).
    """

    def __init__(
        self,
        settings: TextInSettings,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._client = httpx.Client(
            transport=transport,
            timeout=httpx.Timeout(
                settings.timeout_seconds,
                connect=settings.connect_timeout_seconds,
            ),
            headers={
                "x-ti-app-id": settings.textin_app_id,
                "x-ti-secret-code": settings.textin_secret_code,
            },
        )

    @property
    def endpoint(self) -> str:
        return self._settings.textin_endpoint

    def upload_file_sync(
        self,
        filename: str,
        content: bytes,
        content_type: str,
        *,
        parser_params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Single-sync DocFlow upload.

        `parser_params` keys pass through as query string verbatim. At minimum
        `workspace_id` is required and is sourced from settings when not given.
        Returns the parsed JSON body; raises TextInAPIError on transport /
        vendor error.
        """
        query = self._build_query(parser_params or {})
        if not query.get("workspace_id"):
            raise TextInAPIError(
                code=-1,
                msg="workspace_id is required for DocFlow /upload/sync",
            )

        form = {"file": (filename, content, content_type)}
        logger.info(
            "TextIn DocFlow upload_file_sync: filename=%s content_type=%s size=%d query_keys=%s",
            filename,
            content_type,
            len(content),
            sorted(query.keys()),
        )
        resp = self._client.post(self.endpoint, params=query, files=form)
        return self._parse(resp)

    def close(self) -> None:
        self._client.close()

    # --- internals -------------------------------------------------------

    def _build_query(self, parser_params: dict[str, Any]) -> dict[str, Any]:
        """Resolve parser_params + settings.textin_docflow_workspace_id to a query dict.

        Explicit `parser_params` win over settings; settings only fill in the
        workspace_id when the caller omitted it. None values are dropped so the
        URL stays clean and the vendor sees only the keys the caller intended.
        """
        query: dict[str, Any] = {
            "workspace_id": self._settings.textin_docflow_workspace_id,
        }
        for key, value in parser_params.items():
            if value is not None:
                query[key] = value
        return query

    @staticmethod
    def _parse(resp: httpx.Response) -> dict[str, Any]:
        """Decode vendor response and raise TextInAPIError on non-success."""
        decoded = decode_vendor_body(resp.content)

        if resp.status_code != 200:
            raise TextInAPIError(
                code=resp.status_code,
                msg=f"vendor HTTP {resp.status_code}",
                payload={"status_code": resp.status_code, "body": decoded[:512]},
            )

        try:
            payload = json.loads(decoded)
        except ValueError as e:
            raise TextInAPIError(
                code=-1,
                msg=f"non-JSON response: {decoded[:200]}",
                payload={"raw": decoded[:512]},
            ) from e

        if not isinstance(payload, dict):
            raise TextInAPIError(
                code=-1,
                msg="vendor response is not a JSON object",
                payload={"raw_type": type(payload).__name__},
            )

        code = payload.get("code", -1)
        if code != 200:
            raise parse_docflow_error(payload)
        return payload
