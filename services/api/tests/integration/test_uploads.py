"""Uploads, pending records and originals (documents spec: FR-UPLOAD-003/004/005/010/011/013)."""

import io
import zipfile
from datetime import timedelta

import pymupdf
from sqlalchemy import text

from app.clock import utcnow
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant


def pdf(pages: int) -> bytes:
    doc = pymupdf.open()
    for n in range(pages):
        doc.new_page().insert_text((72, 72), f"page {n + 1}")
    data = doc.tobytes()
    doc.close()
    return data


def png() -> bytes:
    return pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False).tobytes("png")


JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64


async def upload(c, name: str, data: bytes, headers: dict | None = None):
    """The three steps; returns the last response (complete, or the failing step)."""
    h = headers or {}
    r = await c.post("/api/v1/uploads", json={"file_name": name}, headers=h)
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    r = await c.put(f"/api/v1/uploads/{uid}/content", content=data, headers=h)
    if r.status_code != 200:
        return r
    return await c.post(f"/api/v1/uploads/{uid}/complete", headers=h)


async def pending(c, headers: dict | None = None) -> list[dict]:
    r = await c.get("/api/v1/files/pending", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


async def test_accepts_jpg_png_pdf(api, line, store):  # AC-FR-UPLOAD-003-01
    await login(api, line)
    for name, data, pages in (("a.jpg", JPG, 1), ("b.png", png(), 1), ("c.pdf", pdf(3), 3)):
        r = await upload(api, name, data)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "READY"
        assert r.json()["page_count"] == pages
    assert [f["original_name"] for f in await pending(api)] == ["c.pdf", "b.png", "a.jpg"]
    assert len(store.objects) == 3


async def test_rejects_disguised_and_docx(api, line, store):  # AC-FR-UPLOAD-003-02
    await login(api, line)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<w/>")
    for name in ("photo.jpg", "contract.docx"):
        r = await upload(api, name, buf.getvalue())
        assert r.status_code == 400
        assert r.json()["code"] == "unsupported_format"
        assert r.json()["fields"] == ["file"]
    assert await pending(api) == []
    assert store.objects == {}


async def test_too_large_and_too_many_pages(api, line, store):  # AC-FR-UPLOAD-003-03
    await login(api, line)
    big = png() + b"\x00" * (20 * 1024 * 1024)
    r = await upload(api, "big.png", big)
    assert (r.status_code, r.json()["code"]) == (400, "file_too_large")
    r = await upload(api, "long.pdf", pdf(51))
    assert (r.status_code, r.json()["code"]) == (400, "too_many_pages")
    assert await pending(api) == []
    assert store.objects == {}


async def test_truncated_pdf_is_corrupt(api, line, store):
    await login(api, line)
    data = pdf(3)
    r = await upload(api, "cut.pdf", data[: len(data) // 3])
    assert (r.status_code, r.json()["code"]) == (400, "file_corrupt")
    assert store.objects == {}


async def test_pdf_with_too_many_pages_rejected(api, line, store):  # Review Focus 3
    await login(api, line)
    r = await upload(api, "bomb.pdf", pdf(300))
    assert (r.status_code, r.json()["code"]) == (400, "too_many_pages")


async def test_batch_failure_isolated(api, line, store):  # AC-FR-UPLOAD-005-01
    await login(api, line)
    results = [
        await upload(api, n, d) for n, d in (("1.png", png()), ("2.txt", b"hi"), ("3.png", png()))
    ]
    assert [r.status_code for r in results] == [200, 400, 200]
    assert [f["original_name"] for f in await pending(api)] == ["3.png", "1.png"]


async def test_complete_twice_returns_state(api, line, store):  # AC-FR-UPLOAD-010-01
    await login(api, line)
    r = await api.post("/api/v1/uploads", json={"file_name": "a.png"})
    uid = r.json()["id"]
    await api.put(f"/api/v1/uploads/{uid}/content", content=png())
    first = await api.post(f"/api/v1/uploads/{uid}/complete")
    again = await api.post(f"/api/v1/uploads/{uid}/complete")
    assert first.status_code == again.status_code == 200
    assert again.json()["status"] == "READY"
    assert len(store.objects) == 1


async def test_unfinished_upload_not_pending_and_expires(api, line, store, db):  # AC-005-02
    await login(api, line)
    r = await api.post("/api/v1/uploads", json={"file_name": "a.png"})
    uid = r.json()["id"]
    await api.put(f"/api/v1/uploads/{uid}/content", content=png())
    assert await pending(api) == []
    await db.execute(
        text("update files set expires_at = :t where id = :i"),
        {"t": utcnow() - timedelta(seconds=1), "i": uid},
    )
    await db.commit()
    r = await api.post(f"/api/v1/uploads/{uid}/complete")
    assert (r.status_code, r.json()["code"]) == (409, "upload_not_ready")
    assert store.objects == {}
    assert await pending(api) == []


async def test_pending_per_tenant_and_delete(api, line, store, db):  # AC-FR-UPLOAD-013-01
    me = await login(api, line)
    org, _ = await make_org(db, me["user_id"])
    for name in ("a.png", "b.png"):
        assert (await upload(api, name, png(), tenant(org))).status_code == 200
    listed = await pending(api, tenant(org))
    assert len(listed) == 2
    assert await pending(api) == []  # the personal tenant does not show them
    r = await api.delete(f"/api/v1/files/{listed[0]['id']}", headers=tenant(org))
    assert r.status_code == 204
    assert len(await pending(api, tenant(org))) == 1


async def test_delete_with_job_is_409(api, line, store, db):  # AC-FR-UPLOAD-013-02
    await login(api, line)
    r = await upload(api, "a.png", png())
    fid = r.json()["id"]
    file_tenant = (
        await db.execute(text("select tenant_id from files where id = :i"), {"i": fid})
    ).scalar()
    await db.execute(
        text(
            "insert into ocr_jobs (id, tenant_id, file_id, status) values ('j-1', :t, :f, 'QUEUED')"
        ),
        {"t": file_tenant, "f": fid},
    )
    await db.commit()
    r = await api.delete(f"/api/v1/files/{fid}")
    assert (r.status_code, r.json()["code"]) == (409, "file_in_use")
    assert len(store.objects) == 1


async def test_other_user_gets_404(api, line, store):  # AC-FR-UPLOAD-011-01
    await login(api, line, "U1")
    fid = (await upload(api, "a.png", png())).json()["id"]
    other = client_like(api)
    await login(other, line, "U2")
    for path in (f"/api/v1/files/{fid}/content", f"/api/v1/files/{fid}/pages/1/preview"):
        assert (await other.get(path)).status_code == 404
    assert (await other.delete(f"/api/v1/files/{fid}")).status_code == 404


async def test_original_and_pdf_page_preview(api, line, store):  # AC-FR-UPLOAD-011-02
    await login(api, line)
    image = png()
    fid = (await upload(api, "a.png", image)).json()["id"]
    r = await api.get(f"/api/v1/files/{fid}/content")
    assert r.status_code == 200 and r.content == image
    assert r.headers["content-type"] == "image/png"
    assert (await api.get(f"/api/v1/files/{fid}/pages/1/preview")).content == image
    pid = (await upload(api, "c.pdf", pdf(3))).json()["id"]
    page = await api.get(f"/api/v1/files/{pid}/pages/2/preview")
    assert page.status_code == 200 and page.content.startswith(b"\x89PNG")
    assert any(name.startswith(f"previews/{pid}/page_2") for name in store.objects)
    assert (await api.get(f"/api/v1/files/{pid}/pages/4/preview")).status_code == 404


async def test_guest_can_upload(api, store):
    await api.post("/api/v1/auth/guest")
    assert (await upload(api, "a.png", png())).status_code == 200
    assert len(await pending(api)) == 1


async def test_member_without_upload_ocr_403(api, line, store, db):
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, _ = await make_org(db, me["user_id"])
    viewer = await make_role(db, org, "Viewer", ["data_browse"])
    member = await login(api, line, "M1")
    await add_member(db, org, member["user_id"], viewer)
    r = await api.post("/api/v1/uploads", json={"file_name": "a.png"}, headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")


async def test_no_bucket_503(api, line):
    await login(api, line)
    r = await api.post("/api/v1/uploads", json={"file_name": "a.png"})
    assert (r.status_code, r.json()["code"]) == (503, "storage_unavailable")


async def test_pdf_work_runs_off_the_event_loop(api, line, store, monkeypatch):
    """Parsing and rendering run in a thread so one big PDF does not stall every request."""
    import asyncio

    from app.services import upload_service

    seen = []
    real = asyncio.to_thread

    async def spy(fn, *args, **kwargs):
        seen.append(getattr(fn, "__name__", str(fn)))
        return await real(fn, *args, **kwargs)

    monkeypatch.setattr(upload_service.asyncio, "to_thread", spy)
    await login(api, line)
    r = await upload(api, "a.pdf", pdf(2))
    assert r.status_code == 200, r.text
    assert (await api.get(f"/api/v1/files/{r.json()['id']}/pages/1/preview")).status_code == 200
    assert "page_count" in seen and "render_page_png" in seen
