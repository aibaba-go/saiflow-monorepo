from pydantic import SecretStr

from app import db
from app.config import Settings


def test_engine_search_path_is_the_fixed_schema(monkeypatch):
    captured = {}
    monkeypatch.setattr(db, "create_async_engine", lambda url, **kw: captured.update(kw))
    db.create_engine(Settings(db_host="h", db_name="n", db_user="u", db_password=SecretStr("p")))
    assert db.SCHEMA == "saiflow_v3"
    assert captured["connect_args"]["server_settings"] == {"search_path": "saiflow_v3"}
