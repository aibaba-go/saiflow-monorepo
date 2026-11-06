"""Public-only URL fetching for imports (FR-UPLOAD-014, Review Focus 1)."""

import httpx
import pytest

from app.ocr.fetch import AddressNotAllowed, FetchFailed, InvalidUrl, TooLarge, fetch_public

PUBLIC = "93.184.216.34"


def resolver(table: dict[str, list[str]]):
    async def resolve(host: str, port: int) -> list[str]:
        return table.get(host, [PUBLIC])

    return resolve


def transport(handler):
    seen: list[str] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return handler(request)

    return httpx.MockTransport(wrapped), seen


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/a.pdf",
        "http://2130706433/a.pdf",
        "http://0x7f000001/a.pdf",
        "http://[::ffff:127.0.0.1]/a.pdf",
        "http://[::1]/a.pdf",
        "http://10.0.0.5/a.pdf",
        "http://169.254.169.254/latest/meta-data",
        "http://localhost/a.pdf",
        "https://inside.example.com/a.pdf",
    ],
)
async def test_rejects_private_forms(url):
    tr, seen = transport(lambda r: httpx.Response(200, content=b"%PDF-"))
    table = {"localhost": ["127.0.0.1"], "inside.example.com": ["10.0.0.5"]}
    with pytest.raises(AddressNotAllowed):
        await fetch_public(url, resolver=resolver(table), transport=tr)
    assert seen == []  # never connected


async def test_redirect_rechecked():
    def handler(request):
        return httpx.Response(302, headers={"location": "http://169.254.169.254/x"})

    tr, seen = transport(handler)
    with pytest.raises(AddressNotAllowed):
        await fetch_public("https://files.example.com/a.pdf", resolver=resolver({}), transport=tr)
    assert seen == [f"https://{PUBLIC}/a.pdf"]  # the checked address, not the name


async def test_too_many_redirects():
    count = {"n": 0}

    def handler(request):
        count["n"] += 1
        return httpx.Response(302, headers={"location": f"/hop{count['n']}"})

    tr, seen = transport(handler)
    with pytest.raises(FetchFailed):
        await fetch_public("https://files.example.com/a", resolver=resolver({}), transport=tr)
    assert len(seen) == 4  # the first request and 3 redirects


async def test_follows_up_to_three_redirects():
    def handler(request):
        if request.url.path == "/final.pdf":
            return httpx.Response(200, content=b"%PDF-1.7 data")
        hop = int(request.url.path.strip("/hop") or 0)
        nxt = "/final.pdf" if hop == 2 else f"/hop{hop + 1}"
        return httpx.Response(302, headers={"location": nxt})

    tr, _ = transport(handler)
    out = await fetch_public("https://files.example.com/hop0", resolver=resolver({}), transport=tr)
    assert out.data.startswith(b"%PDF") and out.final_url.endswith("/final.pdf")


async def test_size_cap_streams():
    big = b"x" * (21 * 1024 * 1024)
    tr, _ = transport(lambda r: httpx.Response(200, content=big))
    with pytest.raises(TooLarge):
        await fetch_public("https://files.example.com/big.pdf", resolver=resolver({}), transport=tr)


async def test_non_200_fails():
    tr, _ = transport(lambda r: httpx.Response(404))
    with pytest.raises(FetchFailed):
        await fetch_public("https://files.example.com/a.pdf", resolver=resolver({}), transport=tr)


@pytest.mark.parametrize(
    "url", ["ftp://files.example.com/a.pdf", "file:///etc/passwd", "a.pdf", ""]
)
async def test_non_http_scheme(url):
    with pytest.raises(InvalidUrl):
        await fetch_public(url, resolver=resolver({}))


async def test_unresolvable_host_fails():
    async def none(host, port):
        return []

    with pytest.raises(FetchFailed):
        await fetch_public("https://nowhere.example/a.pdf", resolver=none)


async def test_connects_to_the_checked_address():
    """Final review 1: the request goes to the address that was checked (no second DNS
    lookup by httpx), with the original Host and TLS name."""
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, content=b"%PDF-1.7")

    await fetch_public(
        "https://files.example.com:8443/a.pdf",
        resolver=resolver({"files.example.com": [PUBLIC]}),
        transport=httpx.MockTransport(handler),
    )
    req = seen[0]
    assert req.url.host == PUBLIC and req.url.port == 8443
    assert req.headers["host"] == "files.example.com:8443"
    assert req.extensions.get("sni_hostname") == "files.example.com"


async def test_redirect_to_a_rebinding_host_is_pinned_too():
    seen: list[str] = []

    def handler(request):
        seen.append(request.url.host)
        if request.url.path == "/a.pdf":
            return httpx.Response(302, headers={"location": "https://cdn.example.net/b.pdf"})
        return httpx.Response(200, content=b"%PDF-1.7")

    out = await fetch_public(
        "https://files.example.com/a.pdf",
        resolver=resolver({"cdn.example.net": ["93.184.216.35"]}),
        transport=httpx.MockTransport(handler),
    )
    assert seen == [PUBLIC, "93.184.216.35"]
    assert out.final_url == "https://cdn.example.net/b.pdf"  # names, not addresses
