from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.errors import AppError


class LooseRequest(BaseModel):
    """Identity request bodies: every field is an optional string. A value of another JSON
    type is dropped and its field name kept in invalid_fields, so the service can answer
    400 listing it (instead of FastAPI's 422)."""

    model_config = ConfigDict(extra="ignore")

    invalid_fields: SkipJsonSchema[list[str]] = Field(default_factory=list, exclude=True)

    @model_validator(mode="before")
    @classmethod
    def _collect_non_text(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        declared = set(cls.model_fields) - {"invalid_fields"}
        clean, invalid = {}, []
        for key, value in data.items():
            if key == "invalid_fields":
                continue
            if key in declared and value is not None and not isinstance(value, str):
                invalid.append(key)
            else:
                clean[key] = value
        clean["invalid_fields"] = invalid
        return clean


def ensure_text(req: LooseRequest) -> None:
    if req.invalid_fields:
        raise AppError(400, "validation_error", "error.validation", list(req.invalid_fields))
