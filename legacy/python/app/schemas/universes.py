"""Request schemas for system and user-owned ticker universes."""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class UniverseCreate(BaseModel):
    """Data required to create a personal ticker universe."""

    name: str = Field(..., min_length=1, max_length=100)
    tickers: List[str] = Field(..., max_length=200)
    description: Optional[str] = Field(None, max_length=500)

    @field_validator("tickers")
    @classmethod
    def validate_tickers(cls, value: List[str]) -> List[str]:
        tickers = [ticker.upper().strip() for ticker in value if ticker.strip()]
        if len(set(tickers)) != len(tickers):
            raise ValueError("Duplicate tickers are not allowed")
        return tickers


class UniverseUpdate(BaseModel):
    """Fields that may be changed on a personal ticker universe."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    tickers: Optional[List[str]] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=500)

    @field_validator("tickers")
    @classmethod
    def validate_tickers(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value
        tickers = [ticker.upper().strip() for ticker in value if ticker.strip()]
        if len(set(tickers)) != len(tickers):
            raise ValueError("Duplicate tickers are not allowed")
        return tickers
