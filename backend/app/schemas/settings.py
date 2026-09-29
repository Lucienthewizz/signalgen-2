"""Request and response models for user-owned application preferences."""

from typing import Any

from pydantic import BaseModel, Field


class SettingsResponse(BaseModel):
    key: str
    value: Any


class SettingsUpdate(BaseModel):
    value: Any


class ModeChange(BaseModel):
    mode: str = Field(
        ...,
        pattern="^(scalping|backtesting|swing|swing_backtest)$",
    )
