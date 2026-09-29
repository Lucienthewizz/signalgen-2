"""Request schemas for user-owned watchlists."""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class WatchlistCreate(BaseModel):
    """Data required to create a watchlist."""

    name: str = Field(..., min_length=1, max_length=100)
    symbols: List[str] = Field(..., min_length=1)

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, value: List[str]) -> List[str]:
        symbols = [symbol.upper().strip() for symbol in value if symbol.strip()]
        if not symbols:
            raise ValueError("At least one symbol is required")
        if len(set(symbols)) != len(symbols):
            raise ValueError("Duplicate symbols are not allowed")
        return symbols


class WatchlistUpdate(BaseModel):
    """Fields that may be changed on an existing watchlist."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    symbols: Optional[List[str]] = Field(None, min_length=1)

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value

        symbols = [symbol.upper().strip() for symbol in value if symbol.strip()]
        if not symbols:
            raise ValueError("At least one symbol is required")
        if len(set(symbols)) != len(symbols):
            raise ValueError("Duplicate symbols are not allowed")
        return symbols
