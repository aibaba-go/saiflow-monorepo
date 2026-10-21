"""TDD: 第五轮 — EXTRACT_V3_ENABLED 灰度开关必须能被环境变量打开。"""

from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def config(monkeypatch):
    def _load(value: str | None):
        if value is None:
            monkeypatch.delenv("EXTRACT_V3_ENABLED", raising=False)
        else:
            monkeypatch.setenv("EXTRACT_V3_ENABLED", value)
        import config as config_module

        return importlib.reload(config_module).Config

    yield _load
    import config as config_module

    importlib.reload(config_module)


def test_flag_defaults_to_false(config):
    assert config(None).EXTRACT_V3_ENABLED is False


@pytest.mark.parametrize("raw", ["true", "True", "TRUE", "1"])
def test_flag_reads_truthy_env_values(config, raw):
    assert config(raw).EXTRACT_V3_ENABLED is True


@pytest.mark.parametrize("raw", ["false", "0", "no", "", "maybe"])
def test_flag_reads_falsy_env_values(config, raw):
    assert config(raw).EXTRACT_V3_ENABLED is False