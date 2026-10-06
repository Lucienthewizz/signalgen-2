"""Application-level health and authenticated status information."""

from datetime import datetime
from typing import Any, Dict

from app.services.engine_service import EngineService
from app.storage.sqlite_repo import SQLiteRepository
from app.ws.broadcaster import SocketIOBroadcaster


class SystemService:
    def __init__(
        self,
        repository: SQLiteRepository,
        broadcaster: SocketIOBroadcaster,
        engine_service: EngineService,
    ):
        self.repository = repository
        self.broadcaster = broadcaster
        self.engine_service = engine_service

    @staticmethod
    def get_api_info() -> Dict[str, str]:
        return {
            "name": "SignalGen API",
            "version": "1.0.0",
            "description": "Real-time scalping signal generator",
            "docs": "/docs",
            "status": "running",
        }

    def get_health(self) -> Dict[str, Any]:
        """Return only the minimum information needed by a health probe."""
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "version": "1.0.0",
            "engine": {"is_running": self.engine_service.is_running},
        }

    def get_status_for_user(self, user_id: str) -> Dict[str, Any]:
        """Return detailed status after enforcing engine-session ownership."""
        engine_status = self.engine_service.get_status_for_user(user_id)
        uptime = "00:00:00"
        if self.engine_service.start_time:
            uptime_seconds = (
                datetime.utcnow() - self.engine_service.start_time
            ).total_seconds()
            hours, remainder = divmod(uptime_seconds, 3600)
            minutes, seconds = divmod(remainder, 60)
            uptime = f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}"

        return {
            "engine": engine_status,
            "database": self.repository.get_database_stats(),
            "websocket": {
                "connected_clients": 0,
                "rooms": self.broadcaster.ROOMS,
            },
            "uptime": uptime,
            "version": "1.0.0",
        }
