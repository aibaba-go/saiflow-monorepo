from app.errors import AppError
from app.services.session_service import Principal


def ensure_tenant_access(principal: Principal, tenant_id: int) -> None:
    """B-2a: a principal sees only its own tenant (B-2b adds team membership)."""
    if tenant_id != principal.tenant_id:
        raise AppError(404, "not_found", "error.not_found")
