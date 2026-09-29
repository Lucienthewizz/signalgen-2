"""Business rules for user-owned application preferences."""

from typing import Any, Dict

from app.core.candle_builder import CandleBuilder
from app.storage.sqlite_repo import SQLiteRepository


class InvalidSettingError(ValueError):
    """Raised when a setting key or value is unsupported."""


class EngineBusyError(RuntimeError):
    """Raised when the active engine prevents a timeframe change."""


class SettingsService:
    VALID_KEYS = {
        "ib_host",
        "ib_port",
        "ib_client_id",
        "max_watchlist_symbols",
        "default_cooldown",
        "bar_size",
        "ui_theme",
        "timeframe",
        "operational_mode",
    }
    DEFAULTS = {
        "ib_host": "127.0.0.1",
        "ib_port": 7497,
        "ib_client_id": 1,
        "max_watchlist_symbols": 5,
        "default_cooldown": 60,
        "bar_size": "5 secs",
        "ui_theme": "light",
        "timeframe": "1m",
        "operational_mode": "scalping",
    }

    def __init__(self, repository: SQLiteRepository, scalping_engine):
        self.repository = repository
        self.scalping_engine = scalping_engine

    def get_for_user(self, user_id: str, key: str) -> Any:
        self._validate_key(key)
        return self.repository.get_user_setting(
            user_id,
            key,
            self.DEFAULTS.get(key),
        )

    def get_all_for_user(self, user_id: str) -> Dict[str, Any]:
        return {
            key: self.get_for_user(user_id, key)
            for key in sorted(self.VALID_KEYS)
        }

    def set_for_user(self, user_id: str, key: str, value: Any) -> None:
        self._validate_key(key)
        if key == "timeframe":
            self._validate_timeframe(value)
        if key == "operational_mode":
            self._validate_mode(value)
        self.repository.set_user_setting(user_id, key, value)

    def change_mode_for_user(self, user_id: str, value: Any) -> str:
        self._validate_mode(value)
        if self.scalping_engine.is_running:
            raise EngineBusyError(
                "Cannot change mode while scalping engine is running. "
                "Stop the engine first."
            )
        self.repository.set_user_setting(
            user_id,
            "operational_mode",
            value,
        )
        return value

    def change_timeframe_for_user(self, user_id: str, value: Any) -> str:
        self._validate_timeframe(value)
        if self.scalping_engine.is_running:
            raise EngineBusyError(
                "Cannot change timeframe while engine is running. Stop the engine first."
            )
        self.scalping_engine.change_timeframe(value)
        self.repository.set_user_setting(user_id, "timeframe", value)
        return value

    def apply_timeframe_for_user(self, user_id: str) -> str:
        timeframe = str(self.get_for_user(user_id, "timeframe"))
        if self.scalping_engine.get_timeframe() != timeframe:
            self.scalping_engine.change_timeframe(timeframe)
        return timeframe

    @classmethod
    def supported_timeframes(cls):
        return CandleBuilder.get_supported_timeframes()

    def _validate_key(self, key: str) -> None:
        if key not in self.VALID_KEYS:
            raise InvalidSettingError(f"Invalid setting key: {key}")

    @staticmethod
    def _validate_timeframe(value: Any) -> None:
        if not isinstance(value, str) or not CandleBuilder.validate_timeframe(value):
            raise InvalidSettingError(
                f"Invalid timeframe: {value}. Must be one of "
                f"{CandleBuilder.get_supported_timeframes()}"
            )

    @staticmethod
    def _validate_mode(value: Any) -> None:
        supported = {"scalping", "backtesting", "swing", "swing_backtest"}
        if not isinstance(value, str) or value not in supported:
            raise InvalidSettingError(
                f"Invalid operational mode: {value}. Must be one of "
                f"{sorted(supported)}"
            )
