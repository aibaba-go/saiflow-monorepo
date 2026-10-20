"""extensions.init_textin 的纯单元测试：覆盖三凭据齐全 / 全缺 / 仅缺 workspace_id 三场景。

对应 task 4.1 的验证：
- 三凭据齐全：注册 `textin_client` 到 app.extensions。
- 任意凭据缺失：不创建 client，记 WARN（warn message 包含具体缺失字段名）。
- atexit 关闭行为不变（client 存在时注册 cleanup）。
"""

from __future__ import annotations

import logging

import pytest
from flask import Flask

from extensions import init_textin


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def _has_textin_client(app: Flask) -> bool:
    return "textin_client" in app.extensions


def test_init_textin_creates_client_when_all_three_credentials_present(
    app: Flask, caplog: pytest.LogCaptureFixture,
) -> None:
    """三凭据齐全 → 创建 client；WARN 不出现。"""
    app.config["TEXTIN_APP_ID"] = "test-app"
    app.config["TEXTIN_SECRET_CODE"] = "test-secret"
    app.config["TEXTIN_DOCFLOW_WORKSPACE_ID"] = "test-ws"

    with caplog.at_level(logging.WARNING, logger="extensions"):
        init_textin(app)

    assert _has_textin_client(app), "textin_client should be registered on app.extensions"
    settings = app.extensions["textin_settings"]
    assert settings.has_credentials() is True
    # WARN should not have been triggered for missing credentials.
    assert not any(
        "凭据缺失" in record.message for record in caplog.records
    ), "no missing-credentials warning expected when all three creds present"


def test_init_textin_skips_client_when_all_credentials_missing(
    app: Flask, caplog: pytest.LogCaptureFixture,
) -> None:
    """三凭据全缺 → 不创建 client；WARN 含三个字段名。"""
    with caplog.at_level(logging.WARNING, logger="extensions"):
        init_textin(app)

    assert not _has_textin_client(app)
    warnings = [r.message for r in caplog.records if "凭据缺失" in r.message]
    assert warnings, "expected a 凭据缺失 WARN"
    msg = warnings[0]
    for name in ("TEXTIN_APP_ID", "TEXTIN_SECRET_CODE", "TEXTIN_DOCFLOW_WORKSPACE_ID"):
        assert name in msg, f"missing-credentials WARN should list {name}, got: {msg!r}"


def test_init_textin_skips_client_when_only_workspace_id_missing(
    app: Flask, caplog: pytest.LogCaptureFixture,
) -> None:
    """只有 workspace_id 缺 → 不创建 client；WARN 明确指出 workspace_id。"""
    app.config["TEXTIN_APP_ID"] = "x"
    app.config["TEXTIN_SECRET_CODE"] = "y"
    # TEXTIN_DOCFLOW_WORKSPACE_ID missing

    with caplog.at_level(logging.WARNING, logger="extensions"):
        init_textin(app)

    assert not _has_textin_client(app)
    warnings = [r.message for r in caplog.records if "凭据缺失" in r.message]
    assert warnings
    msg = warnings[0]
    assert "TEXTIN_DOCFLOW_WORKSPACE_ID" in msg
    # The two present credentials should not be listed.
    assert "TEXTIN_APP_ID" not in msg
    assert "TEXTIN_SECRET_CODE" not in msg


def test_init_textin_skips_client_when_only_app_id_missing(
    app: Flask, caplog: pytest.LogCaptureFixture,
) -> None:
    """只有 app_id 缺 → WARN 列出 TEXTIN_APP_ID，不含其他两个。"""
    app.config["TEXTIN_SECRET_CODE"] = "y"
    app.config["TEXTIN_DOCFLOW_WORKSPACE_ID"] = "ws"

    with caplog.at_level(logging.WARNING, logger="extensions"):
        init_textin(app)

    assert not _has_textin_client(app)
    warnings = [r.message for r in caplog.records if "凭据缺失" in r.message]
    assert warnings
    msg = warnings[0]
    assert "TEXTIN_APP_ID" in msg
    assert "TEXTIN_SECRET_CODE" not in msg
    assert "TEXTIN_DOCFLOW_WORKSPACE_ID" not in msg


def test_init_textin_skips_client_when_only_secret_missing(
    app: Flask, caplog: pytest.LogCaptureFixture,
) -> None:
    """只有 secret_code 缺 → WARN 列出 TEXTIN_SECRET_CODE。"""
    app.config["TEXTIN_APP_ID"] = "x"
    app.config["TEXTIN_DOCFLOW_WORKSPACE_ID"] = "ws"

    with caplog.at_level(logging.WARNING, logger="extensions"):
        init_textin(app)

    assert not _has_textin_client(app)
    warnings = [r.message for r in caplog.records if "凭据缺失" in r.message]
    msg = warnings[0]
    assert "TEXTIN_SECRET_CODE" in msg
    assert "TEXTIN_APP_ID" not in msg
    assert "TEXTIN_DOCFLOW_WORKSPACE_ID" not in msg


def test_init_textin_skips_client_when_app_id_and_secret_missing(
    app: Flask, caplog: pytest.LogCaptureFixture,
) -> None:
    """app_id 和 secret 都缺（workspace_id 在）→ WARN 列表里只列两者。"""
    app.config["TEXTIN_DOCFLOW_WORKSPACE_ID"] = "ws"

    with caplog.at_level(logging.WARNING, logger="extensions"):
        init_textin(app)

    assert not _has_textin_client(app)
    warnings = [r.message for r in caplog.records if "凭据缺失" in r.message]
    msg = warnings[0]
    assert "TEXTIN_APP_ID" in msg
    assert "TEXTIN_SECRET_CODE" in msg
    assert "TEXTIN_DOCFLOW_WORKSPACE_ID" not in msg


def test_init_textin_client_settings_persist_to_app_extensions(
    app: Flask,
) -> None:
    """settings（即便 client 没创建）也要写到 app.extensions 给 worker / adapter 用。"""
    app.config["TEXTIN_APP_ID"] = "x"
    app.config["TEXTIN_SECRET_CODE"] = "y"
    app.config["TEXTIN_DOCFLOW_WORKSPACE_ID"] = "ws"

    init_textin(app)

    settings = app.extensions["textin_settings"]
    assert settings.textin_app_id == "x"
    assert settings.textin_secret_code == "y"
    assert settings.textin_docflow_workspace_id == "ws"


def test_init_textin_when_no_credentials_app_still_has_settings(
    app: Flask,
) -> None:
    """凭据全缺时 settings 仍然写到 app.extensions（worker 应当用 OCR_VENDOR_UNAVAILABLE 退）。"""
    init_textin(app)

    assert "textin_settings" in app.extensions
    assert not _has_textin_client(app)
