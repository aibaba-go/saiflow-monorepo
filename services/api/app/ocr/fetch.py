"""Fetch a file from a public URL for an import (FR-UPLOAD-014).

Only public addresses are ever contacted, so an import cannot be used to reach internal
services:
- `http`/`https` only;
- the host is resolved first and every address must be global (IPv4-mapped IPv6 unwrapped;
  numeric hosts such as `2130706433` or `0x7f000001` are read as addresses);
- redirects are followed by hand, at most `max_redirects`, each new URL checked again;
- the connection goes to the checked address (the name only in Host and TLS), so a DNS
  answer that changes after the check cannot redirect it; the peer is checked again;
- at most `max_bytes`, and `timeout` seconds in all.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

MAX_BYTES = 20 * 1024 * 1024
TIMEOUT = 20.0
MAX_REDIRECTS = 3
_REDIRECTS = {301, 302, 303, 307, 308}

Resolver = Callable[[str, int], Awaitable[list[str]]]


class InvalidUrl(ValueError):
    pass


class AddressNotAllowed(ValueError):
    pass


class FetchFailed(RuntimeError):
    pass


class TooLarge(ValueError):
    pass


@dataclass
class FetchResult:
    data: bytes
    final_url: str


async def system_resolver(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


def _literal(host: str) -> ipaddress._BaseAddress | None:
    text = host.strip("[]")
    try:
        return ipaddress.ip_address(text.split("%")[0])
    except ValueError:
        pass
    try:  # numeric forms a resolver would accept: 2130706433, 0x7f000001
        number = int(text, 16) if text.lower().startswith("0x") else int(text)
    except ValueError:
        return None
    try:
        return ipaddress.ip_address(number)
    except ValueError:
        return None


def allowed(address: str | ipaddress._BaseAddress) -> bool:
    ip = address if not isinstance(address, str) else _literal(address)
    if ip is None:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global


def parse_url(url: str) -> httpx.URL:
    try:
        parsed = httpx.URL(url)
    except (httpx.InvalidURL, TypeError, ValueError):
        raise InvalidUrl(url) from None
    if parsed.scheme not in ("http", "https") or not parsed.host:
        raise InvalidUrl(url)
    return parsed


async def _check_host(parsed: httpx.URL, resolver: Resolver) -> str:
    """The address to connect to: every resolved address must be global."""
    literal = _literal(parsed.host)
    if literal is not None:
        if not allowed(literal):
            raise AddressNotAllowed(parsed.host)
        return str(literal)
    try:
        addresses = await resolver(
            parsed.host, parsed.port or (443 if parsed.scheme == "https" else 80)
        )
    except OSError:
        raise FetchFailed(f"cannot resolve {parsed.host}") from None
    if not addresses:
        raise FetchFailed(f"cannot resolve {parsed.host}")
    if not all(allowed(a) for a in addresses):
        raise AddressNotAllowed(parsed.host)
    return addresses[0]


def _check_peer(response: httpx.Response) -> None:
    stream = response.extensions.get("network_stream")
    if stream is None:  # mock transports have no socket
        return
    peer = stream.get_extra_info("server_addr")
    if peer and not allowed(str(peer[0])):
        raise AddressNotAllowed(str(peer[0]))


async def _fetch(url, max_bytes, max_redirects, resolver, transport, timeout) -> FetchResult:
    current = parse_url(url)
    async with httpx.AsyncClient(
        transport=transport, follow_redirects=False, timeout=timeout, trust_env=False
    ) as client:
        for _hop in range(max_redirects + 1):
            address = await _check_host(current, resolver)
            # Connect to the checked address itself: httpx must not resolve the name again
            # (a DNS answer that changes in between would reach an internal host). The
            # name stays in Host and in TLS (SNI and the certificate check).
            pinned = current.copy_with(host=address)
            async with client.stream(
                "GET",
                pinned,
                headers={
                    "User-Agent": "saiflow-import/1.0",
                    "Host": current.netloc.decode("ascii"),
                    "Accept-Encoding": "identity",
                },
                extensions={"sni_hostname": current.host},
            ) as response:
                _check_peer(response)
                if response.status_code in _REDIRECTS:
                    location = response.headers.get("location")
                    if not location:
                        raise FetchFailed("redirect without location")
                    current = parse_url(str(current.join(location)))
                    continue
                if response.status_code != 200:
                    raise FetchFailed(f"status {response.status_code}")
                chunks, size = [], 0
                async for chunk in response.aiter_bytes(65536):
                    size += len(chunk)
                    if size > max_bytes:
                        raise TooLarge(f"more than {max_bytes} bytes")
                    chunks.append(chunk)
                return FetchResult(b"".join(chunks), str(current))
    raise FetchFailed("too many redirects")


async def fetch_public(
    url: str,
    *,
    max_bytes: int = MAX_BYTES,
    timeout: float = TIMEOUT,
    max_redirects: int = MAX_REDIRECTS,
    resolver: Resolver = system_resolver,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FetchResult:
    try:
        async with asyncio.timeout(timeout):
            return await _fetch(url, max_bytes, max_redirects, resolver, transport, timeout)
    except (InvalidUrl, AddressNotAllowed, TooLarge, FetchFailed):
        raise
    except (TimeoutError, httpx.HTTPError) as exc:
        raise FetchFailed(type(exc).__name__) from None
