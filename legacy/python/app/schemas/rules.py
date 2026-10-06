"""Request schemas for trading-rule endpoints."""

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, field_validator


class RuleCreate(BaseModel):
    """Model for creating a new rule."""

    name: str = Field(..., min_length=1, max_length=100)
    definition: Dict[str, Any] = Field(...)

    @field_validator("definition")
    @classmethod
    def validate_definition(cls, value):
        for field in ("logic", "conditions"):
            if field not in value:
                raise ValueError(f"Missing required field in rule definition: {field}")
        return value


class RuleUpdate(BaseModel):
    """Model for updating an existing rule."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    definition: Optional[Dict[str, Any]] = Field(None)

    @field_validator("definition")
    @classmethod
    def validate_definition(cls, value):
        if value is not None:
            for field in ("logic", "conditions"):
                if field not in value:
                    raise ValueError(f"Missing required field in rule definition: {field}")
        return value
