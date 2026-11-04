from pydantic import BaseModel

from app.schemas.loose import LooseRequest


class AdminLoginRequest(LooseRequest):
    username: str | None = None
    password: str | None = None


class AdminMeResponse(BaseModel):
    admin_id: int
    username: str
