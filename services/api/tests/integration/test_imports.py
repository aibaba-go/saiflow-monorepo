"""Importing a file from a URL (FR-UPLOAD-014). The fetcher is replaced: its address rules
are covered by tests/unit/test_fetch.py."""

from sqlalchemy import text

from app.ocr.fetch import AddressNotAllowed, FetchFailed, FetchResult, TooLarge
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant
from tests.integration.test_uploads import pdf, png

IMPORTS = "/api/v1/file-imports"


def fake_fetch(api, outcome):
    calls: list[str] = []

    async def fetch(url, **_):
        calls.append(url)
        if isinstance(outcome, Exception):
            raise outcome
        return FetchResult(outcome, url)

    api.app.state.fetch_public = fetch
    return calls


async def pending(api):
    return (await api.get("/api/v1/files/pending")).json()


async def test_import_pdf(api, line, store, db):  # AC-FR-UPLOAD-014-01
    await login(api, line)
    fake_fetch(api, pdf(2))
    r = await api.post(IMPORTS, json={"url": "https://example.com/inv.pdf"})
    assert r.status_code == 201, r.text
    assert (r.json()["original_name"], r.json()["page_count"]) == ("inv.pdf", 2)
    assert [f["original_name"] for f in await pending(api)] == ["inv.pdf"]
    assert (await db.execute(text("select count(*) from ocr_jobs"))).scalar() == 0


async def test_import_errors(api, line, store):  # AC-FR-UPLOAD-014-02/03
    await login(api, line)
    cases = [
        (AddressNotAllowed("x"), "import_address_not_allowed"),
        (FetchFailed("404"), "import_fetch_failed"),
        (TooLarge("x"), "file_too_large"),
        (b"<!doctype html><html></html>", "unsupported_format"),
    ]
    for outcome, code in cases:
        fake_fetch(api, outcome)
        r = await api.post(IMPORTS, json={"url": "https://example.com/a.pdf"})
        assert (r.status_code, r.json()["code"]) == (400, code), r.text
    r = await api.post(IMPORTS, json={"url": "ftp://example.com/a.pdf"})
    assert (r.status_code, r.json()["code"]) == (400, "import_invalid_url")
    assert await pending(api) == []
    assert not any(n.startswith("originals/") for n in store.objects)


async def test_import_needs_upload_ocr(api, line, store, db):  # AC-FR-UPLOAD-014-04
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, _ = await make_org(db, me["user_id"])
    role = await make_role(db, org, "Viewer", ["data_browse"])
    member = await login(api, line, "M1")
    await add_member(db, org, member["user_id"], role)
    calls = fake_fetch(api, pdf(1))
    r = await api.post(IMPORTS, json={"url": "https://example.com/a.pdf"}, headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    assert calls == []  # nothing fetched


async def test_import_name(api, line, store):
    await login(api, line)
    fake_fetch(api, pdf(1))
    r = await api.post(IMPORTS, json={"url": "https://x.example/a/b%20c.pdf?x=1"})
    assert r.json()["original_name"] == "b_c.pdf"
    fake_fetch(api, png())
    r = await api.post(IMPORTS, json={"url": "https://x.example/"})
    assert r.json()["original_name"] == "import.png"
    fake_fetch(api, png())
    r = await api.post(IMPORTS, json={"url": "https://x.example/photo.pdf"})
    assert r.json()["original_name"] == "photo.png"  # the content decides the extension
