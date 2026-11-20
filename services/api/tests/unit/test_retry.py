import pytest

from app.retry import with_retries


class Transient(Exception):
    pass


class Permanent(Exception):
    pass


def _is_transient(exc: BaseException) -> bool:
    return isinstance(exc, Transient)


class Recorder:
    def __init__(self):
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


async def test_retries_transient_three_times():
    calls = 0
    sleep = Recorder()

    async def call():
        nonlocal calls
        calls += 1
        raise Transient("down")

    with pytest.raises(Transient):
        await with_retries(call, is_transient=_is_transient, sleep=sleep)
    assert calls == 4
    assert sleep.delays == [0.5, 1.0, 2.0]


async def test_no_retry_for_permanent_error():
    calls = 0

    async def call():
        nonlocal calls
        calls += 1
        raise Permanent("bad input")

    with pytest.raises(Permanent):
        await with_retries(call, is_transient=_is_transient, sleep=Recorder())
    assert calls == 1


async def test_returns_after_transient_then_success():
    calls = 0

    async def call():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise Transient("blip")
        return "ok"

    assert await with_retries(call, is_transient=_is_transient, sleep=Recorder()) == "ok"
    assert calls == 2
