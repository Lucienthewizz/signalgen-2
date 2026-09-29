"""Request and response models for the live scalping engine."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class EngineStart(BaseModel):
    """Configuration required to start the live engine."""

    watchlist_id: int = Field(..., gt=0)
    rule_id: int = Field(..., gt=0)
    demo: bool = Field(
        default=False,
        description="Run in demo mode with synthetic data instead of IBKR",
    )


class EngineStatus(BaseModel):
    """Public engine status returned to its authenticated owner."""

    is_running: bool
    is_connected: bool
    state: Dict[str, Any]
    active_watchlist: List[str]
    active_rule: Optional[Dict[str, Any]]
    ibkr_connected: bool
    reconnect_attempts: int
    connection_details: Dict[str, Any]
