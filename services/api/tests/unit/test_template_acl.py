"""Who may manage templates, and the shape of the use rule (FR-TEMPLATE-009, D1/D4)."""

from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from app.errors import AppError
from app.permissions import ALL, Permission
from app.services import template_access
from app.services import template_management_service as svc
from app.services.tenant_access import TenantContext


def ctx(kind, *, owner=False, perms=frozenset(), user_id=5, tenant_id=10):
    return TenantContext(tenant_id, kind, user_id, owner, None, frozenset(perms))


@pytest.mark.parametrize(
    ("context", "allowed"),
    [
        (ctx("personal", owner=True, perms=ALL), True),
        (ctx("guest", owner=True, perms=ALL, user_id=None), False),  # never a guest
        (ctx("organization", owner=True), True),
        (ctx("organization", perms={Permission.TEMPLATE_MANAGE}), True),
        (ctx("organization"), False),
        (ctx("organization", perms=ALL - {Permission.TEMPLATE_MANAGE}), False),
    ],
)
def test_can_manage(context, allowed):
    assert template_access.can_manage(context) is allowed
    if allowed:
        template_access.require_manage(context)
    else:
        with pytest.raises(AppError) as exc:
            template_access.require_manage(context)
        assert (exc.value.status, exc.value.code, exc.value.message_key) == (
            403,
            "permission_denied",
            "error.permission_denied",
        )


def test_tenant_actor():
    assert svc.tenant_actor(ctx("personal")) == svc.Actor("user", "5", user_id=5)
    assert svc.tenant_actor(ctx("guest", user_id=None)) == svc.Actor("guest", "10")
    assert svc.admin_actor(3) == svc.Actor("admin", "3", admin_id=3)


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeDb:
    def __init__(self, tenant, plan):
        self.tenant, self.plan = tenant, plan

    async def get(self, _model, _id):
        return self.tenant

    async def execute(self, _query):
        return _Result(self.plan)


async def _condition_sql(tenant, plan) -> str:
    cond = await template_access._grant_condition(FakeDb(tenant, plan), 10)
    return str(cond.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


PERSONAL = SimpleNamespace(kind="personal", owner_user_id=5)
ORG = SimpleNamespace(kind="organization", owner_user_id=None)
GUEST = SimpleNamespace(kind="guest", owner_user_id=None)


async def test_named_grant_needs_active_plan():
    with_plan = await _condition_sql(PERSONAL, "starter")
    assert "TARGETS" in with_plan and "template_grant_targets.user_id = 5" in with_plan
    assert "'starter' = ANY" in with_plan
    without = await _condition_sql(PERSONAL, None)
    assert "TARGETS" not in without and "ANY" not in without  # only the universal grant
    assert "@>" in without


async def test_org_named_grant_and_guest():
    org = await _condition_sql(ORG, "advance")
    assert "template_grant_targets.organization_tenant_id = 10" in org
    guest = await _condition_sql(GUEST, "kinder")
    assert "TARGETS" not in guest  # a guest tenant is never a named target
    assert "document_templates.tenant_id IS NULL" in guest
