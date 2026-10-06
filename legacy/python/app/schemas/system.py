"""Response models for API and authenticated system status endpoints."""

from typing import Any, Dict

from pydantic import BaseModel

from app.schemas.engine import EngineStatus


class SystemStatus(BaseModel):
    engine: EngineStatus
    database: Dict[str, Any]
    websocket: Dict[str, Any]
    uptime: str
    version: str = "1.0.0"
