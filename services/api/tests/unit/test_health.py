async def test_health_ok(client_db_ok):  # AC-FR-PLAT-001-01
    r = await client_db_ok.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": "test-sha", "database": "ok"}


async def test_health_db_down(client_db_down):  # AC-FR-PLAT-001-02 (logic)
    r = await client_db_down.get("/api/v1/health")
    assert r.status_code == 503
    assert r.json() == {"status": "degraded", "version": "test-sha", "database": "error"}


async def test_health_in_openapi(client):
    spec = (await client.get("/api/v1/openapi.json")).json()
    op = spec["paths"]["/api/v1/health"]["get"]
    assert op["operationId"] == "getHealth" and {"200", "503"} <= set(op["responses"])
