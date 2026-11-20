"""Template audit entries carry who/scope/id/revision/version, never content (FR-TEMPLATE-007)."""

import pytest

from app.errors import AppError
from app.services import template_management_service as svc


class FakeDb:
    def __init__(self):
        self.calls: list[str] = []

    async def rollback(self):
        self.calls.append("rollback")

    async def commit(self):
        self.calls.append("commit")


@pytest.fixture
def recorded(monkeypatch):
    events = []

    async def record(db, event):
        db.calls.append("record")
        events.append(event)

    monkeypatch.setattr(svc.audit_service, "record", record)
    return events


def test_target_format():
    assert svc.audit_target(7, None, 3) == "7/system/r3"
    assert svc.audit_target(7, 12, 4, 2) == "7/tenant:12/r4/v2"
    assert svc.audit_target("new", "tenant:12", 1) == "new/tenant:12/r1"


async def test_success_event(recorded):
    db = FakeDb()
    await svc.audit(db, svc.admin_actor(9), "template.activate", svc.audit_target(1, None, 2, 1))
    (event,) = recorded
    assert (event.actor_type, event.actor_id, event.action) == ("admin", "9", "template.activate")
    assert (event.target_type, event.target_id, event.result) == (
        "document_template",
        "1/system/r2/v1",
        "success",
    )


@pytest.mark.parametrize("status", [403, 409, 422])
async def test_refusal_rolled_back_and_logged(recorded, status):
    db = FakeDb()
    secret = "groups-with-secret-field-name"

    async def fn():
        raise AppError(status, "some_code", "error.some_code", details={"content": secret})

    with pytest.raises(AppError):
        await svc.audited(db, svc.Actor("user", "5", user_id=5), "template.save", "3", fn)
    assert db.calls == ["rollback", "record", "commit"]
    (event,) = recorded
    assert (event.action, event.target_id, event.result) == (
        "template.save",
        "3/some_code",
        "failure",
    )
    assert secret not in repr(event)  # no content or details in the log


async def test_not_found_not_logged(recorded):
    db = FakeDb()

    async def fn():
        raise AppError(404, "not_found", "error.not_found")

    with pytest.raises(AppError):
        await svc.audited(db, svc.Actor("guest", "4"), "template.delete", "3", fn)
    assert db.calls == [] and recorded == []


async def test_success_passes_result(recorded):
    db = FakeDb()

    async def fn():
        return 42

    assert await svc.audited(db, svc.admin_actor(1), "template.create", "new/system", fn) == 42
    assert recorded == [] and db.calls == []  # the change logs its own success
