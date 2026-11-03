"""Retry for transient failures of external services (decision D5 of rebuild-skeleton).

Transient errors (timeouts, the other side's server errors, rate limits) are retried
`retries` times with doubling waits; anything else is raised at once."""

import asyncio
from collections.abc import Awaitable, Callable


async def with_retries[T](
    call: Callable[[], Awaitable[T]],
    *,
    is_transient: Callable[[BaseException], bool],
    retries: int = 3,
    base_delay: float = 0.5,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    attempt = 0
    while True:
        try:
            return await call()
        except Exception as exc:
            if not is_transient(exc) or attempt >= retries:
                raise
            await sleep(base_delay * 2**attempt)
            attempt += 1
