"""Live engine lifecycle and per-user authorization."""

import asyncio
import logging
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks

from app.engines.scalping_engine import ScalpingEngine
from app.services.rule_service import RuleNotFoundError, RuleService
from app.services.watchlist_service import (
    WatchlistNotFoundError,
    WatchlistService,
)
from app.ws.broadcaster import SocketIOBroadcaster


class EngineAlreadyRunningError(Exception):
    """Raised when a second engine session is requested."""


class EngineNotRunningError(Exception):
    """Raised when a user tries to stop an inactive engine."""


class EngineAccessDeniedError(Exception):
    """Raised when a user accesses another user's engine session."""


class EngineService:
    """Own the single MVP engine session and bind it to one user."""

    def __init__(
        self,
        scalping_engine: ScalpingEngine,
        broadcaster: SocketIOBroadcaster,
        rule_service: RuleService,
        watchlist_service: WatchlistService,
        logger: Optional[logging.Logger] = None,
        settings_service=None,
    ):
        self.scalping_engine = scalping_engine
        self.broadcaster = broadcaster
        self.rule_service = rule_service
        self.watchlist_service = watchlist_service
        self.logger = logger or logging.getLogger(__name__)
        self.settings_service = settings_service
        self._lock = threading.Lock()
        self._is_running = False
        self._start_time: Optional[datetime] = None
        self._owner_user_id: Optional[str] = None
        self._engine_loop: Optional[asyncio.AbstractEventLoop] = None

    @property
    def is_running(self) -> bool:
        return self._is_running

    @property
    def is_busy(self) -> bool:
        """Include the short startup window reserved for the session owner."""
        return self._is_running or self._owner_user_id is not None

    @property
    def start_time(self) -> Optional[datetime]:
        return self._start_time

    @property
    def owner_user_id(self) -> Optional[str]:
        return self._owner_user_id

    def get_status_for_user(self, user_id: str) -> Dict[str, Any]:
        """Return status only when no session exists or the user owns it."""
        self._ensure_owner(user_id)
        return self.scalping_engine.get_engine_status_sync()

    def start_for_user(
        self,
        watchlist_id: int,
        rule_id: int,
        demo: bool,
        user_id: str,
        background_tasks: BackgroundTasks,
    ) -> None:
        """Validate owned inputs, reserve the session, and start the engine."""
        with self._lock:
            if self._is_running or self._owner_user_id is not None:
                raise EngineAlreadyRunningError

            # Both lookups deliberately return not-found for another user's
            # private resource so callers cannot enumerate resource IDs.
            watchlist = self.watchlist_service.get_for_user(
                watchlist_id,
                user_id,
            )
            self.rule_service.get_for_user(rule_id, user_id)
            if self.settings_service is not None:
                self.settings_service.apply_timeframe_for_user(user_id)
            self._owner_user_id = user_id
            self.broadcaster.active_user_id = user_id

        try:
            threading.Thread(
                target=self._start_engine_in_thread,
                args=(watchlist["symbols"], rule_id, user_id, demo),
                daemon=True,
            ).start()
            background_tasks.add_task(self._broadcast_status_after_start)
        except Exception:
            self._clear_runtime_state()
            raise

    def stop_for_user(self, user_id: str) -> None:
        """Stop the engine only for the user who started the session."""
        with self._lock:
            if not self._is_running and self._owner_user_id is None:
                raise EngineNotRunningError
            if self._owner_user_id != user_id:
                raise EngineAccessDeniedError

        threading.Thread(
            target=self._stop_and_broadcast,
            args=(user_id,),
            daemon=True,
        ).start()

    async def get_safe_status(self) -> Dict[str, Any]:
        """Return engine health data without propagating runtime failures."""
        try:
            return await self.scalping_engine.get_engine_status()
        except Exception as error:
            self.logger.error("Error getting engine status: %s", error)
            return {
                "is_running": False,
                "is_connected": False,
                "state": {"state": "error"},
                "active_watchlist": [],
                "active_rule": None,
                "ibkr_connected": False,
                "reconnect_attempts": 0,
                "connection_details": {"error": str(error)},
            }

    def _ensure_owner(self, user_id: str) -> None:
        with self._lock:
            if (
                self._owner_user_id is not None
                and self._owner_user_id != user_id
            ):
                raise EngineAccessDeniedError
            if self._is_running and self._owner_user_id is None:
                raise EngineAccessDeniedError

    def _clear_runtime_state(self) -> None:
        with self._lock:
            self._is_running = False
            self._start_time = None
            self._owner_user_id = None
            self.scalping_engine.current_user_id = None
            self.broadcaster.active_user_id = None

    def _start_engine_in_thread(
        self,
        symbols: List[str],
        rule_id: int,
        user_id: str,
        demo: bool = False,
    ) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._engine_loop = loop

        try:
            started = loop.run_until_complete(
                self._start_engine_async(symbols, rule_id, user_id, demo)
            )
            if started:
                self.logger.info(
                    "Engine started, keeping event loop running for real-time updates",
                    extra={"user_id": user_id},
                )
                loop.run_forever()
        except Exception as error:
            self.logger.error(
                "Error in engine thread: %s",
                error,
                extra={"user_id": user_id},
            )
            self._clear_runtime_state()
        finally:
            loop.close()
            self._engine_loop = None

    async def _start_engine_async(
        self,
        symbols: List[str],
        rule_id: int,
        user_id: str,
        demo: bool = False,
    ) -> bool:
        try:
            with self._lock:
                self._is_running = True
                self._start_time = datetime.utcnow()

            if demo:
                success = await self.scalping_engine.start_demo_engine(
                    symbols,
                    rule_id,
                    user_id,
                )
            else:
                success = await self.scalping_engine.start_engine(
                    symbols,
                    rule_id,
                    user_id,
                )
            self.logger.info(
                "Engine start returned %s (demo=%s)",
                success,
                demo,
                extra={"user_id": user_id},
            )

            if not success:
                self._clear_runtime_state()
                self._broadcast_error(
                    "Failed to connect to IBKR. Please ensure TWS or "
                    "IB Gateway is running.",
                    user_id,
                )
                return False
            return True
        except Exception as error:
            self._clear_runtime_state()
            self.logger.error(
                "Error starting engine: %s",
                error,
                extra={"user_id": user_id},
            )
            self._broadcast_error(str(error), user_id)
            return False

    def _stop_and_broadcast(self, user_id: str) -> None:
        try:
            stopped = self._stop_engine_in_thread()
            if not stopped:
                return
            time.sleep(0.5)
            self.broadcaster.broadcast_engine_status_sync(
                self._stopped_status(),
                user_id=user_id,
            )
            self.logger.info(
                "Broadcasted stopped status",
                extra={"user_id": user_id},
            )
        except Exception as error:
            self.logger.error(
                "Error in stop thread: %s",
                error,
                extra={"user_id": user_id},
            )

    def _stop_engine_in_thread(self) -> bool:
        if self._engine_loop and self._engine_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self._stop_engine_async(),
                self._engine_loop,
            )
            try:
                stopped = future.result(timeout=5.0)
            except Exception as error:
                self.logger.error("Error waiting for engine stop: %s", error)
                return False
            if not stopped:
                return False
            self._engine_loop.call_soon_threadsafe(self._engine_loop.stop)
            self.logger.info("Stopped engine event loop")
            return True

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self._stop_engine_async())
        finally:
            loop.close()

    async def _stop_engine_async(self) -> bool:
        try:
            await self.scalping_engine.stop_engine()
            self.logger.info("Engine stopped successfully")
            self._clear_runtime_state()
            return True
        except Exception as error:
            self.logger.error("Error stopping engine: %s", error)
            return False

    async def _broadcast_status_after_start(self) -> None:
        await asyncio.sleep(0.5)
        try:
            status = {
                "is_running": self._is_running,
                "is_connected": self.scalping_engine.is_connected,
                "ibkr_connected": self.scalping_engine.is_connected,
                "demo_mode": self.scalping_engine.demo_mode,
                "state": {
                    "state": "running" if self._is_running else "stopped"
                },
                "active_watchlist": list(
                    getattr(self.scalping_engine, "active_watchlist", [])
                ),
                "active_rule": getattr(
                    self.scalping_engine,
                    "active_rule",
                    None,
                ),
                "subscribed_symbols": list(
                    getattr(
                        self.scalping_engine,
                        "subscribed_contracts",
                        {},
                    ).keys()
                ),
                "reconnect_enabled": True,
                "reconnect_attempts": 0,
                "connection_details": {},
            }
            self.broadcaster.broadcast_engine_status_sync(status)
        except Exception as error:
            self.logger.error(
                "Error broadcasting engine status: %s",
                error,
                exc_info=True,
            )

    def _broadcast_error(self, message: str, user_id: str) -> None:
        try:
            status = self._stopped_status()
            status["error"] = message
            self.broadcaster.broadcast_engine_status_sync(
                status,
                user_id=user_id,
            )
        except Exception:
            self.logger.exception("Failed to broadcast engine error")

    @staticmethod
    def _stopped_status() -> Dict[str, Any]:
        return {
            "is_running": False,
            "is_connected": False,
            "ibkr_connected": False,
            "state": {"state": "stopped"},
            "active_watchlist": [],
            "active_rule": None,
            "subscribed_symbols": [],
            "reconnect_enabled": False,
            "reconnect_attempts": 0,
            "connection_details": {},
        }
