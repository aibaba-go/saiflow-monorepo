from app.schemas.loose import LooseRequest as _Loose


class EmailCodeRequest(_Loose):
    email: str | None = None


class RegistrationRequest(_Loose):
    email: str | None = None
    code: str | None = None
    display_name: str | None = None
    phone: str | None = None


class ProfileUpdate(_Loose):
    """Only the fields present are changed; an empty phone clears it."""

    display_name: str | None = None
    phone: str | None = None


class EmailChangeRequest(_Loose):
    email: str | None = None
    code: str | None = None
