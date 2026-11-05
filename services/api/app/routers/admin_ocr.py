"""Admin OCR engine and LLM settings (FR-SYS-005)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import AdminContext, get_admin, get_db, get_settings, require_csrf_header
from app.errors import AppError
from app.schemas.loose import ensure_text
from app.schemas.ocr import KeyStatusOut, OcrSettingsIn, OcrSettingsOut
from app.services import ocr_settings_service
from app.services.ocr_settings_service import OcrSettings

router = APIRouter(
    prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_csrf_header)]
)
Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[AdminContext, Depends(get_admin)]
Env = Annotated[Settings, Depends(get_settings)]


def _out(current: OcrSettings, env: Settings) -> OcrSettingsOut:
    return OcrSettingsOut(
        **current.__dict__, keys=KeyStatusOut(**ocr_settings_service.key_status(env))
    )


@router.get("/ocr-settings", operation_id="adminGetOcrSettings", response_model=OcrSettingsOut)
async def get_ocr_settings(db: Db, admin: Admin, env: Env) -> OcrSettingsOut:
    return _out(await ocr_settings_service.get(db), env)


@router.patch("/ocr-settings", operation_id="adminUpdateOcrSettings", response_model=OcrSettingsOut)
async def update_ocr_settings(req: OcrSettingsIn, db: Db, admin: Admin, env: Env) -> OcrSettingsOut:
    ensure_text(req)
    changes = {k: getattr(req, k) for k in req.model_fields_set if k != "invalid_fields"}
    if any(v is None for v in changes.values()):
        raise AppError(
            400,
            "validation_error",
            "error.validation",
            sorted(k for k, v in changes.items() if v is None),
        )
    return _out(await ocr_settings_service.update(db, admin.account.id, changes), env)
