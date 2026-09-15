"""Request schemas for swing screening and cache preparation."""

from typing import List, Optional

from pydantic import BaseModel, Field


class SwingScreenRequest(BaseModel):
    """Parameters for screening one authorized ticker universe."""

    rule_id: int = Field(..., gt=0)
    ticker_universe_id: int = Field(..., gt=0)
    timeframe: str = Field(default="1d", pattern="^(1h|4h|1d)$")
    lookback_days: int = Field(default=30, ge=1, le=365)
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class YahooBackfillRequest(BaseModel):
    """Parameters for warming Yahoo OHLCV cache for an authorized universe."""

    ticker_universe_id: int = Field(..., gt=0)
    timeframes: List[str] = Field(default_factory=lambda: ["1d"], max_length=6)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
