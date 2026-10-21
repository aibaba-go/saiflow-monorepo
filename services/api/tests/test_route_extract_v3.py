"""TDD: 第六轮 — POST /api/v1/ocr/jobs 接受 params.extract_v3 任务级覆盖。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from flask import Flask

from extensions import db


@pytest.fixture
def env(tmp_path, monkeypatch):
    from config import Config
    from errors import ApiError, error_response
    from middleware import register_security
    from routes import v1_bp

    app = Flask(__name__)
    app.config.from_object(Config)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{tmp_path / 'api.db'}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["TESTING"] = True
    db.init_app(app)
    import models  # noqa: F401 建表前注册 metadata

    with app.app_context():
        db.create_all()
    app.register_blueprint(v1_bp, url_prefix="/api/v1")
    register_security(app)

    @app.errorhandler(ApiError)
    def _handle(err):
        return error_response(err)

    monkeypatch.setattr("quota.check_and_consume", lambda job: None)

    import auth
    from models import File, User

    with app.app_context():
        user = User(line_sub="u-route")
        db.session.add(user)
        db.session.flush()
        file = File(
            created_by_user_id=user.id, uploader_user_id=user.id,
            original_name="doc.png", storage_path="s/doc.png", page_count=1, status="READY",
        )
        db.session.add(file)
        db.session.commit()
        file_id = file.id
        with app.test_request_context("/api/v1/auth/line"):
            _, token, csrf = auth.create_session(user)
        db.session.commit()  # create_session 只 flush；不提交则会话行随上下文回滚

    http = app.test_client()
    http.set_cookie(app.config["SESSION_COOKIE_NAME"], token, path="/api")
    http.environ_base["HTTP_X_CSRF_TOKEN"] = csrf
    return SimpleNamespace(app=app, http=http, file_id=file_id)


def _create(env, params):
    return env.http.post(
        "/api/v1/ocr/jobs",
        json={"file_id": env.file_id, "params": params},
    )


def _stored_params(env, job_id):
    from models import OcrJob

    with env.app.app_context():
        return dict(db.session.get(OcrJob, job_id).params)


def test_extract_v3_true_is_persisted(env):
    resp = _create(env, {"extract_v3": True})
    assert resp.status_code == 201
    assert _stored_params(env, resp.get_json()["data"]["id"])["extract_v3"] is True


def test_extract_v3_false_is_persisted(env):
    resp = _create(env, {"extract_v3": False})
    assert resp.status_code == 201
    assert _stored_params(env, resp.get_json()["data"]["id"])["extract_v3"] is False


def test_extract_v3_non_bool_is_rejected(env):
    resp = _create(env, {"extract_v3": "yes"})
    assert resp.status_code == 400
    assert resp.get_json()["field_errors"][0]["field"] == "extract_v3"


def test_extract_v3_absent_is_not_stored(env):
    resp = _create(env, {"page": 0})
    assert resp.status_code == 201
    assert "extract_v3" not in _stored_params(env, resp.get_json()["data"]["id"])