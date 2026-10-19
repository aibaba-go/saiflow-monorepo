"""textin.config 的纯单元测试：仅覆盖 settings 装配 + 默认值不变（不依赖 Flask / 网络）。

对应 task 1.1 的验证：
- `textin_app_id` / `textin_secret_code` 不再硬编码 vendor 默认值（替换为 `""`）。
- `textin_docflow_workspace_id` 新增且 env 可覆盖。
- `timeout_seconds` 默认 300.0。
- env 优先级：app_config > env > candidate default。
"""

from __future__ import annotations

import pytest

from textin.config import TextInSettings, build_textin_settings


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "TEXTIN_APP_ID",
        "TEXTIN_SECRET_CODE",
        "TEXTIN_DOCFLOW_WORKSPACE_ID",
        "TEXTIN_TIMEOUT_SECONDS",
    ):
        monkeypatch.delenv(key, raising=False)


def test_textinsettings_no_vendor_defaults_in_module_source() -> None:
    """SaiFlow 源码不应再含任何硬编码 vendor 凭据默认值。"""
    import inspect

    from textin import config

    src = inspect.getsource(config)
    assert "4a8a32165b164e4fef6f2e54336de2d7" not in src, "hardcoded TEXTIN_APP_ID default leaked"
    assert "eac1b93270d3c7b9b7641c89309bb444" not in src, "hardcoded TEXTIN_SECRET_CODE default leaked"


def test_textinsettings_direct_default_timeout() -> None:
    """直接构造 TextInSettings 时，timeout 默认 300.0，凭证默认空。"""
    settings = TextInSettings()
    assert settings.timeout_seconds == 300.0
    assert settings.textin_app_id == ""
    assert settings.textin_secret_code == ""
    assert settings.textin_docflow_workspace_id == ""


def test_build_textin_settings_with_no_env_uses_empty_defaults() -> None:
    """无 env、无 app.config：所有 vendor 字段均为空字符串，has_credentials() 为 False。"""
    settings = build_textin_settings({})
    assert settings.textin_app_id == ""
    assert settings.textin_secret_code == ""
    assert settings.textin_docflow_workspace_id == ""
    assert settings.timeout_seconds == 300.0
    assert settings.has_credentials() is False


def test_build_textin_settings_env_overrides_default() -> None:
    """env 设置三个变量后应被读取，has_credentials() 为 True。"""
    import os

    os.environ["TEXTIN_APP_ID"] = "test-app-id"
    os.environ["TEXTIN_SECRET_CODE"] = "test-secret"
    os.environ["TEXTIN_DOCFLOW_WORKSPACE_ID"] = "test-workspace"
    try:
        settings = build_textin_settings({})
    finally:
        for k in ("TEXTIN_APP_ID", "TEXTIN_SECRET_CODE", "TEXTIN_DOCFLOW_WORKSPACE_ID"):
            os.environ.pop(k, None)
    assert settings.textin_app_id == "test-app-id"
    assert settings.textin_secret_code == "test-secret"
    assert settings.textin_docflow_workspace_id == "test-workspace"
    assert settings.has_credentials() is True


def test_build_textin_settings_app_config_beats_env() -> None:
    """Flask app.config 显式给值时优先级高于 env。"""
    import os

    os.environ["TEXTIN_APP_ID"] = "from-env"
    try:
        settings = build_textin_settings({"TEXTIN_APP_ID": "from-config"})
    finally:
        os.environ.pop("TEXTIN_APP_ID", None)
    assert settings.textin_app_id == "from-config"


def test_build_textin_settings_missing_workspace_blocks_credentials() -> None:
    """只有 app_id/secret 但 workspace_id 缺失时，has_credentials() 必须返回 False。"""
    settings = build_textin_settings(
        {
            "TEXTIN_APP_ID": "x",
            "TEXTIN_SECRET_CODE": "y",
            # TEXTIN_DOCFLOW_WORKSPACE_ID omitted
        }
    )
    assert settings.textin_docflow_workspace_id == ""
    assert settings.has_credentials() is False
