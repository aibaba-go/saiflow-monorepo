from pydantic import BaseModel, ConfigDict


class AdminLoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    username: str | None = None
    password: str | None = None


class AdminMeResponse(BaseModel):
    admin_id: int
    username: str
