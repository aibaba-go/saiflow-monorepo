async def test_post_without_csrf_header_is_403(client):
    r = await client.post("/api/v1/auth/guest")
    assert r.status_code == 403
    assert r.json()["code"] == "csrf_header_missing"
