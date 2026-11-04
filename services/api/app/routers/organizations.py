"""Customer endpoints for organizations (rebuild-tenant-rbac). Management endpoints take
the organization ID in the path and resolve it through the tenant access rule."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, require_csrf_header, require_registered_user
from app.schemas.loose import ensure_text
from app.schemas.organization import ApplicationOut, OrganizationProfileIn
from app.services import organization_service
from app.services.session_service import Principal

router = APIRouter(
    prefix="/api/v1", tags=["organizations"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Registered = Annotated[Principal, Depends(require_registered_user)]


@router.post(
    "/organization-applications",
    operation_id="applyForOrganization",
    status_code=201,
    response_model=ApplicationOut,
)
async def apply_for_organization(
    req: OrganizationProfileIn, db: Db, principal: Registered
) -> ApplicationOut:
    ensure_text(req)
    application = await organization_service.apply(
        db,
        principal.user_id,
        req.name,
        req.contact_phone,
        req.address,  # type: ignore[arg-type]
    )
    return ApplicationOut.model_validate(application, from_attributes=True)


@router.get(
    "/me/organization-applications",
    operation_id="listMyOrganizationApplications",
    response_model=list[ApplicationOut],
)
async def list_my_applications(db: Db, principal: Registered) -> list[ApplicationOut]:
    found = await organization_service.my_applications(db, principal.user_id)  # type: ignore[arg-type]
    return [ApplicationOut.model_validate(a, from_attributes=True) for a in found]
