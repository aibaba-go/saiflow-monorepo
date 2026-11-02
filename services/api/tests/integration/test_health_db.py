import time

import pytest

from app.main import create_app
from tests.conftest import get_health

pytestmark = pytest.mark.integration


async def test_health_db_refused_hides_connection_details(settings):  # AC-FR-PLAT-001-03
    s = settings.model_copy(
        update={"db_host": "127.0.0.1", "db_port": 1, "db_user": "visible_user_name"}
    )
    r = await get_health(create_app(s))
    assert r.status_code == 503
    for secret in ["127.0.0.1", "visible_user_name", s.db_password.get_secret_value(), "Traceback"]:
        assert secret not in r.text


async def test_health_db_hangs_returns_503_within_5s(settings, silent_tcp_server):  # AC-002 / RF2
    s = settings.model_copy(update={"db_host": "127.0.0.1", "db_port": silent_tcp_server.port})
    t0 = time.monotonic()
    r = await get_health(create_app(s))
    assert r.status_code == 503 and time.monotonic() - t0 < 5.0


async def test_health_with_real_db_ok(db_settings):
    r = await get_health(create_app(db_settings))
    assert r.status_code == 200 and r.json()["database"] == "ok"
