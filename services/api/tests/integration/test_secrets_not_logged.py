import pytest

from app.logging_setup import configure_logging
from app.main import create_app
from tests.conftest import get_health

pytestmark = pytest.mark.integration


async def test_password_absent_from_logs_and_response(db_settings, capsys, caplog):  # 003-02
    configure_logging()
    app = create_app(db_settings)
    r = await get_health(app)
    pw = db_settings.db_password.get_secret_value()
    assert pw not in r.text and pw not in caplog.text and pw not in capsys.readouterr().out
