"""待处理记录与文件删除 / 取消上传测试（FR-UPLOAD-013）。

GET /files/pending、DELETE /files/<id>，以及删除与 content / complete / 建任务的串行保护。
真实中间件 + 真实会话 + 路由模块逐个加载（不导入 app.py），文件型 SQLite 与本地对象存储都落在
仓库根 temp/ 下并在用例结束后清理；不连共享库、不访问网络。
SQLite 不支持 SELECT ... FOR UPDATE（行锁语句被忽略），并发窗口用「在写存储/读存储/解析租户时
由第二条连接提交删除」模拟，验证 populate_existing 重读后的状态判断。文件内容为合成数据。
"""
from __future__ import annotations

import importlib.util
import shutil
import socket
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from flask import Flask
from sqlalchemy import create_engine, text

import storage
from auth import create_session
from config import Config
from errors import ApiError, error_response
from extensions import db
from middleware import register_security
from models import AuditEvent, Enterprise, File, Membership, OcrJob, Tenant, User

API_DIR = Path(__file__).resolve().parent
TEMP_ROOT = API_DIR.parents[1] / "temp" / "test_pending_files"
PNG = b"\x89PNG\r\n\x1a\n" + b"synthetic-png-body"
BASE_TIME = datetime(2026, 10, 20, 8, 0, 0)


def _load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, API_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    previous = sys.modules.get(name)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        if previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous
    return module


@pytest.fixture(scope="module")
def routes():
    package = ModuleType("routes")
    package.__path__ = []
    with pytest.MonkeyPatch.context() as loader:
        loader.setitem(sys.modules, "routes", package)
        ocr = _load_module("routes.ocr", "routes/ocr.py")
        loader.setitem(sys.modules, "routes.ocr", ocr)
        files = _load_module("routes.files", "routes/files.py")
        yield SimpleNamespace(ocr=ocr, files=files)


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("pending file tests must not open network connections")

    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)


@pytest.fixture()
def storage_dir():
    path = TEMP_ROOT / uuid.uuid4().hex
    path.mkdir(parents=True)
    yield path
    shutil.rmtree(path, ignore_errors=True)
    if TEMP_ROOT.exists() and not any(TEMP_ROOT.iterdir()):
        TEMP_ROOT.rmdir()


@pytest.fixture()
def app(routes, storage_dir, monkeypatch):
    # 订阅门禁不在本需求范围内：放行，避免依赖套餐种子
    monkeypatch.setattr(routes.ocr.quota, "check_and_consume", lambda job: None)

    app = Flask(__name__)
    app.config.from_object(Config)
    app.config.update(
        # 文件型 SQLite（落在 temp/ 下）：并发窗口用第二条连接提交，才能验证 populate_existing 重读
        SQLALCHEMY_DATABASE_URI=f"sqlite:///{(storage_dir / 'pending.db').as_posix()}",
        SQLALCHEMY_ENGINE_OPTIONS={},
        SECRET_KEY="synthetic-pending-test-key", AUTH_DEV_MODE=False,
        STORAGE_BACKEND="local",
        FILE_STORAGE_DIR=str(storage_dir / "files"),
        EXPORT_STORAGE_DIR=str(storage_dir / "exports"),
        OCR_STORAGE_DIR=str(storage_dir / "ocr"),
    )
    db.init_app(app)
    for bp in (routes.files.bp, routes.ocr.ocr_bp):
        app.register_blueprint(bp, url_prefix="/api/v1")
    register_security(app)

    @app.errorhandler(ApiError)
    def _api_error(err):
        return error_response(err)

    registered = datetime(2026, 10, 1)
    with app.app_context():
        db.create_all()
        db.session.add_all([
            User(id=1, line_provider="line", line_sub="synthetic-1", display_name="Synthetic A",
                 registered_at=registered),
            User(id=2, line_provider="line", line_sub="synthetic-2", display_name="Synthetic B",
                 registered_at=registered),
        ])
        db.session.flush()
        db.session.add_all([
            Tenant(id=7, tenant_type="PERSONAL", owner_user_id=1, display_name="t7", status="ACTIVE"),
            Tenant(id=8, tenant_type="PERSONAL", owner_user_id=2, display_name="t8", status="ACTIVE"),
            Tenant(id=20, tenant_type="ENTERPRISE", display_name="Synthetic Co", status="ACTIVE"),
        ])
        db.session.flush()
        db.session.add_all([
            Enterprise(tenant_id=20, code="ent-261020-synth", legal_name="Synthetic Co",
                       status="VERIFIED", verified_at=registered),
            Membership(tenant_id=20, user_id=1, role="OWNER", status="ACTIVE"),
            Membership(tenant_id=20, user_id=2, role="MEMBER", status="ACTIVE"),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()
        db.engine.dispose()


def _login(app, user_id: int):
    """真实会话：返回已带 Cookie 的客户端与 CSRF 头。"""
    client = app.test_client()
    with app.test_request_context():
        _, token, csrf = create_session(db.session.get(User, user_id))
        db.session.commit()
    client.set_cookie(Config.SESSION_COOKIE_NAME, token, path="/api")
    return client, {Config.CSRF_HEADER_NAME: csrf}


@pytest.fixture()
def owner(app):
    return _login(app, 1)


@pytest.fixture()
def stranger(app):
    return _login(app, 2)


def _seed_file(app, *, user_id=1, tenant_id=7, purpose="OCR_TASK", status="READY", minutes=0,
               page_count=1, with_object=False, name="synthetic.png") -> str:
    with app.app_context():
        f = File(tenant_id=tenant_id, created_by_user_id=user_id, uploader_user_id=user_id,
                 purpose=purpose, original_name=name, mime_type="image/png", status=status,
                 page_count=page_count, created_at=BASE_TIME + timedelta(minutes=minutes))
        db.session.add(f)
        db.session.flush()
        if with_object:
            f.storage_path = storage.put_bytes("files", f"{f.id}.png", PNG, "image/png")
            f.size_bytes = len(PNG)
        db.session.commit()
        return f.id


def _seed_job(app, file_id: str, *, user_id=1, tenant_id=7, status="SUCCEEDED") -> str:
    with app.app_context():
        job = OcrJob(tenant_id=tenant_id, created_by_user_id=user_id, file_id=file_id, status=status)
        db.session.add(job)
        db.session.commit()
        return job.id


def _status(app, file_id: str) -> str:
    with app.app_context():
        return db.session.get(File, file_id).status


def _pending_ids(client, tenant_id=None) -> list[str]:
    url = "/api/v1/files/pending" + (f"?tenant_id={tenant_id}" if tenant_id is not None else "")
    resp = client.get(url)
    assert resp.status_code == 200, resp.get_json()
    return [item["id"] for item in resp.get_json()["data"]["items"]]


def _mark_deleted_raw(file_id: str) -> None:
    """模拟另一请求在并发窗口里提交了删除：第二条独立连接直接改库并提交，
    当前请求会话的身份映射里仍是旧快照（只有 populate_existing 重读才看得到 DELETED）。"""
    other = create_engine(db.engine.url)
    try:
        with other.begin() as conn:
            conn.execute(text("UPDATE files SET status = 'DELETED' WHERE id = :id"), {"id": file_id})
    finally:
        other.dispose()


def _upload(client, csrf, *, content=True, complete=True, name="synthetic.png", data=PNG) -> str:
    resp = client.post("/api/v1/uploads", json={"file_name": name, "purpose": "OCR_TASK"}, headers=csrf)
    assert resp.status_code == 201, resp.get_json()
    file_id = resp.get_json()["data"]["upload_id"]
    if content:
        resp = client.put(f"/api/v1/uploads/{file_id}/content", data=data, headers=csrf)
        assert resp.status_code == 200, resp.get_json()
    if complete:
        resp = client.post(f"/api/v1/uploads/{file_id}/complete", headers=csrf)
        assert resp.status_code == 200, resp.get_json()
    return file_id


# ---------- GET /files/pending ----------


def test_pending_lists_only_own_ready_ocr_files_without_jobs(app, owner):
    older = _seed_file(app, minutes=1)
    newer = _seed_file(app, minutes=5)
    for status in ("UPLOADING", "UPLOADED", "VALIDATING", "REJECTED", "DELETED"):
        _seed_file(app, status=status, minutes=9)
    _seed_file(app, purpose="APPLICATION_MATERIAL", minutes=9)
    _seed_job(app, _seed_file(app, minutes=9))                    # 已建过任务
    _seed_job(app, _seed_file(app, minutes=9), status="FAILED")   # 任务失败也算已引用
    _seed_file(app, user_id=2, tenant_id=8, minutes=9)            # 他人个人租户
    _seed_file(app, user_id=2, tenant_id=20, minutes=9)           # 同企业其他成员
    mine_in_company = _seed_file(app, tenant_id=20, minutes=3)

    client, _ = owner
    assert _pending_ids(client) == [newer, older]                  # created_at 降序、缺省=个人租户
    assert _pending_ids(client, "") == [newer, older]
    assert _pending_ids(client, 7) == [newer, older]
    assert _pending_ids(client, 20) == [mine_in_company]           # 企业租户只看本人上传

    item = client.get("/api/v1/files/pending").get_json()["data"]["items"][0]
    assert item["status"] == "READY" and item["purpose"] == "OCR_TASK" and item["tenant_id"] == 7


def test_pending_rejects_inaccessible_tenants(app, owner):
    client, _ = owner
    _seed_file(app, user_id=2, tenant_id=8)
    resp = client.get("/api/v1/files/pending?tenant_id=8")         # 他人个人租户
    assert resp.status_code == 403 and resp.get_json()["code"] == "PERMISSION_DENIED"
    resp = client.get("/api/v1/files/pending?tenant_id=abc")
    assert resp.status_code == 400 and resp.get_json()["message_key"] == "error.invalid_workspace"
    with app.app_context():
        db.session.query(Membership).filter_by(user_id=1).update({"status": "REMOVED"})
        db.session.commit()
    resp = client.get("/api/v1/files/pending?tenant_id=20")        # 已退出企业
    assert resp.status_code == 403 and resp.get_json()["code"] == "ENTERPRISE_ACCESS_REVOKED"
    assert app.test_client().get("/api/v1/files/pending").status_code == 401


def test_pending_is_capped_at_100(app, owner):
    with app.app_context():
        db.session.add_all([
            File(tenant_id=7, created_by_user_id=1, uploader_user_id=1, original_name=f"s{i}.png",
                 status="READY", page_count=1, created_at=BASE_TIME + timedelta(seconds=i))
            for i in range(105)
        ])
        db.session.commit()
    ids = _pending_ids(owner[0])
    assert len(ids) == 100
    with app.app_context():
        assert db.session.get(File, ids[0]).original_name == "s104.png"


def test_static_pending_route_is_not_shadowed_by_file_id(app, owner):
    client, _ = owner
    resp = client.get("/api/v1/files/pending")
    assert resp.status_code == 200 and resp.get_json()["data"] == {"items": []}
    file_id = _seed_file(app)
    assert client.get(f"/api/v1/files/{file_id}").get_json()["data"]["file"]["id"] == file_id


def test_creating_job_removes_file_from_pending_and_blocks_delete(app, owner):
    client, csrf = owner
    file_id = _upload(client, csrf)
    assert _pending_ids(client) == [file_id]
    resp = client.post("/api/v1/ocr/jobs", json={"file_id": file_id}, headers=csrf)
    assert resp.status_code == 201, resp.get_json()
    assert _pending_ids(client) == []

    resp = client.delete(f"/api/v1/files/{file_id}", headers=csrf)
    assert resp.status_code == 409 and resp.get_json()["message_key"] == "files.in_use"
    assert _status(app, file_id) == "READY"


# ---------- DELETE /files/<id> ----------


def test_delete_ready_file_cleans_storage_and_is_idempotent(app, owner):
    client, csrf = owner
    file_id = _upload(client, csrf)
    with app.app_context():
        original = Path(db.session.get(File, file_id).storage_path)
        preview = Path(storage.put_bytes("previews", f"{file_id}/page_1.png", PNG, "image/png"))
    assert original.exists() and preview.exists()

    resp = client.delete(f"/api/v1/files/{file_id}", headers=csrf)
    assert resp.status_code == 200
    assert resp.get_json()["data"] == {"file_id": file_id, "status": "DELETED"}
    assert not original.exists() and not preview.exists()
    assert _pending_ids(client) == []
    with app.app_context():
        f = db.session.get(File, file_id)
        assert f.status == "DELETED" and f.reject_reason == ""

    again = client.delete(f"/api/v1/files/{file_id}", headers=csrf)
    assert again.status_code == 200
    assert again.get_json()["data"] == {"file_id": file_id, "status": "DELETED"}
    with app.app_context():
        events = AuditEvent.query.filter_by(action="file.deleted", object_id=file_id).all()
        assert len(events) == 1  # 幂等重放不重复审计
        assert events[0].user_id == 1 and events[0].object_type == "file"
        assert events[0].detail == {"from_status": "READY"}

    # 删除后：原件/预览不可读，不能再建任务、不能再完成上传
    assert client.get(f"/api/v1/files/{file_id}/content").status_code == 404
    assert client.get(f"/api/v1/files/{file_id}/pages/1/preview").status_code == 404
    resp = client.post("/api/v1/ocr/jobs", json={"file_id": file_id}, headers=csrf)
    assert resp.status_code == 409 and resp.get_json()["message_key"] == "job.file_not_ready"
    assert client.post(f"/api/v1/uploads/{file_id}/complete", headers=csrf).status_code == 409
    with app.app_context():
        assert OcrJob.query.count() == 0


def test_delete_removes_every_cached_preview_page(app, owner):
    client, csrf = owner
    file_id = _seed_file(app, page_count=3, with_object=True, name="synthetic.pdf")
    with app.app_context():
        previews = [
            Path(storage.put_bytes("previews", f"{file_id}/page_{n}.png", PNG, "image/png"))
            for n in (1, 2, 3)
        ]
    assert client.delete(f"/api/v1/files/{file_id}", headers=csrf).status_code == 200
    assert not any(p.exists() for p in previews)


@pytest.mark.parametrize("status", ["UPLOADED", "VALIDATING", "REJECTED"])
def test_delete_accepts_every_non_terminal_upload_state(app, owner, status):
    client, csrf = owner
    file_id = _seed_file(app, status=status)
    resp = client.delete(f"/api/v1/files/{file_id}", headers=csrf)
    assert resp.status_code == 200 and _status(app, file_id) == "DELETED"
    with app.app_context():
        event = AuditEvent.query.filter_by(action="file.deleted", object_id=file_id).one()
        assert event.detail == {"from_status": status}


def test_delete_is_owner_only_and_ocr_task_only(app, owner, stranger):
    client, csrf = owner
    others = _seed_file(app, user_id=2, tenant_id=20)              # 同企业他人上传：同样 404
    material = _seed_file(app, purpose="APPLICATION_MATERIAL")
    mine = _seed_file(app)

    for file_id in (others, material, "0" * 32):
        resp = client.delete(f"/api/v1/files/{file_id}", headers=csrf)
        assert resp.status_code == 404 and resp.get_json()["code"] == "RESOURCE_NOT_FOUND", file_id
    s_client, s_csrf = stranger
    assert s_client.delete(f"/api/v1/files/{mine}", headers=s_csrf).status_code == 404
    assert _status(app, others) == "READY" and _status(app, material) == "READY"
    assert _status(app, mine) == "READY"
    with app.app_context():
        assert AuditEvent.query.filter_by(action="file.deleted").count() == 0


def test_delete_with_any_job_reference_conflicts(app, owner):
    client, csrf = owner
    file_id = _seed_file(app)
    _seed_job(app, file_id, status="CANCELLED")
    resp = client.delete(f"/api/v1/files/{file_id}", headers=csrf)
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "STATE_CONFLICT" and resp.get_json()["message_key"] == "files.in_use"
    assert _status(app, file_id) == "READY"


def test_delete_requires_session_and_csrf(app, owner):
    client, _ = owner
    file_id = _seed_file(app)
    resp = client.delete(f"/api/v1/files/{file_id}")
    assert resp.status_code == 403 and resp.get_json()["code"] == "CSRF_INVALID"
    assert app.test_client().delete(f"/api/v1/files/{file_id}").status_code == 401
    assert _status(app, file_id) == "READY"


# ---------- 取消上传与并发保护 ----------


def test_cancel_uploading_session_blocks_content_and_complete(app, owner):
    client, csrf = owner
    file_id = _upload(client, csrf, content=False, complete=False)
    assert _status(app, file_id) == "UPLOADING"
    resp = client.delete(f"/api/v1/files/{file_id}", headers=csrf)
    assert resp.status_code == 200
    with app.app_context():
        event = AuditEvent.query.filter_by(action="file.deleted", object_id=file_id).one()
        assert event.detail == {"from_status": "UPLOADING"}

    resp = client.put(f"/api/v1/uploads/{file_id}/content", data=PNG, headers=csrf)
    assert resp.status_code == 409 and resp.get_json()["code"] == "STATE_CONFLICT"
    assert client.post(f"/api/v1/uploads/{file_id}/complete", headers=csrf).status_code == 409
    assert _status(app, file_id) == "DELETED"
    with app.app_context():
        assert not Path(storage.stored_path("files", f"{file_id}.png")).exists()


def test_content_written_after_concurrent_delete_is_discarded(app, owner, routes, monkeypatch):
    client, csrf = owner
    file_id = _upload(client, csrf, content=False, complete=False)
    real_put = routes.files.storage.put_bytes

    def put_then_deleted(category, name, data, mime):
        path = real_put(category, name, data, mime)
        _mark_deleted_raw(file_id)  # 写存储期间被取消
        return path

    monkeypatch.setattr(routes.files.storage, "put_bytes", put_then_deleted)
    resp = client.put(f"/api/v1/uploads/{file_id}/content", data=PNG, headers=csrf)
    assert resp.status_code == 409 and resp.get_json()["code"] == "STATE_CONFLICT"
    with app.app_context():
        f = db.session.get(File, file_id)
        assert f.status == "DELETED" and f.storage_path == "" and f.sha256 == ""
        assert not Path(storage.stored_path("files", f"{file_id}.png")).exists()


def test_complete_after_concurrent_delete_does_not_become_ready(app, owner, routes, monkeypatch):
    client, csrf = owner
    file_id = _upload(client, csrf, complete=False)
    real_get = routes.files.storage.get_bytes

    def deleted_while_validating(path):
        _mark_deleted_raw(file_id)
        return real_get(path)

    monkeypatch.setattr(routes.files.storage, "get_bytes", deleted_while_validating)
    resp = client.post(f"/api/v1/uploads/{file_id}/complete", headers=csrf)
    assert resp.status_code == 409 and resp.get_json()["code"] == "STATE_CONFLICT"
    assert _status(app, file_id) == "DELETED"
    assert _pending_ids(client) == []


def test_reject_during_validation_keeps_deleted(app, owner, routes, monkeypatch):
    client, csrf = owner
    file_id = _upload(client, csrf, complete=False, name="synthetic.pdf", data=b"%PDF-broken")

    def deleted_while_validating(path):
        _mark_deleted_raw(file_id)
        return b"%PDF-broken"

    monkeypatch.setattr(routes.files.storage, "get_bytes", deleted_while_validating)
    resp = client.post(f"/api/v1/uploads/{file_id}/complete", headers=csrf)
    assert resp.status_code == 400 and resp.get_json()["message_key"] == "files.corrupt_or_encrypted"
    assert _status(app, file_id) == "DELETED"  # 不被覆盖为 REJECTED


def test_create_job_rechecks_file_under_lock(app, owner, routes, monkeypatch):
    client, csrf = owner
    file_id = _upload(client, csrf)
    real_resolve = routes.ocr.resolve_tenant

    def deleted_before_insert(user, tenant_id=None):
        tenant = real_resolve(user, tenant_id)
        _mark_deleted_raw(file_id)  # get_file_for_user 之后、建任务之前被删除
        return tenant

    monkeypatch.setattr(routes.ocr, "resolve_tenant", deleted_before_insert)
    resp = client.post("/api/v1/ocr/jobs", json={"file_id": file_id}, headers=csrf)
    assert resp.status_code == 409 and resp.get_json()["message_key"] == "job.file_not_ready"
    with app.app_context():
        assert OcrJob.query.count() == 0


def test_rerun_on_deleted_file_conflicts(app, owner):
    client, csrf = owner
    file_id = _seed_file(app)
    job_id = _seed_job(app, file_id, status="FAILED")
    with app.app_context():
        db.session.get(File, file_id).status = "DELETED"  # 历史脏数据兜底：rerun 仍拒绝
        db.session.commit()
    resp = client.post(f"/api/v1/ocr/jobs/{job_id}/rerun", headers=csrf)
    assert resp.status_code == 409 and resp.get_json()["message_key"] == "job.file_not_ready"
