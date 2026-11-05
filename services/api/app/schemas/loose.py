import typing
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.errors import AppError


def _accepts(annotation: Any, value: Any) -> bool:
    """Whether a JSON value fits the field's declared kind: str, int, bool or list[str]."""
    if value is None:
        return True
    args = [a for a in typing.get_args(annotation) if a is not type(None)] or [annotation]
    for kind in args:
        origin = typing.get_origin(kind)
        if kind is str and isinstance(value, str):
            return True
        if kind is bool and isinstance(value, bool):
            return True
        if kind is int and isinstance(value, int) and not isinstance(value, bool):
            return -(2**63) <= value < 2**63  # fits bigint (N1)
        if origin is list and isinstance(value, list):
            (item,) = typing.get_args(kind) or (str,)
            return all(_accepts(item, v) for v in value)
    return False


class LooseRequest(BaseModel):
    """Request bodies whose fields are all optional. A value of the wrong JSON type is
    dropped and its field name kept in invalid_fields, so the service can answer 400
    listing it (instead of FastAPI's 422)."""

    model_config = ConfigDict(extra="ignore")

    invalid_fields: SkipJsonSchema[list[str]] = Field(default_factory=list, exclude=True)

    @model_validator(mode="before")
    @classmethod
    def _collect_wrong_types(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        fields = {k: f.annotation for k, f in cls.model_fields.items() if k != "invalid_fields"}
        clean, invalid = {}, []
        for key, value in data.items():
            if key == "invalid_fields":
                continue
            if key in fields and not _accepts(fields[key], value):
                invalid.append(key)
            else:
                clean[key] = value
        clean["invalid_fields"] = invalid
        return clean


def ensure_text(req: LooseRequest) -> None:
    if req.invalid_fields:
        raise AppError(400, "validation_error", "error.validation", list(req.invalid_fields))
