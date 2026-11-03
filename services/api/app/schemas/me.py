from pydantic import BaseModel, ConfigDict


class _Loose(BaseModel):
    """Fields are optional strings; content rules are checked in services (HTTP 400)."""

    model_config = ConfigDict(extra="ignore")


class EmailCodeRequest(_Loose):
    email: str | None = None
