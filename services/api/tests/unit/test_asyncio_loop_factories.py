import asyncio
import sys

import pytest

from tests import conftest


@pytest.mark.parametrize("platform", ["linux", "darwin", "win32"])
def test_ac_nfr_dev_003_loop_factories_are_valid_on_every_platform(monkeypatch, platform):
    with monkeypatch.context() as patch:
        patch.setattr(sys, "platform", platform)
        factories = conftest.pytest_asyncio_loop_factories()

    assert isinstance(factories, dict) and factories
    for factory in factories.values():
        assert callable(factory)
        loop = factory()
        try:
            assert isinstance(loop, asyncio.AbstractEventLoop)
            if platform == "win32":
                assert isinstance(loop, asyncio.SelectorEventLoop)
        finally:
            loop.close()
