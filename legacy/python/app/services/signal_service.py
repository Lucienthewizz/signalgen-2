"""Business logic and ownership boundaries for generated signals."""

from typing import Dict, List, Optional

from app.storage.sqlite_repo import SQLiteRepository


class SignalNotFoundError(Exception):
    """Raised when a signal is unavailable to the current user."""


class SignalService:
    """Read and delete signals only within one user's ownership scope."""

    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def list_for_user(
        self,
        user_id: str,
        limit: int = 100,
        symbol: Optional[str] = None,
    ) -> List[Dict]:
        normalized_symbol = symbol.strip().upper() if symbol else None
        return self.repository.get_signals_for_user(
            user_id=user_id,
            limit=limit,
            symbol=normalized_symbol,
        )

    def delete_for_user(self, signal_id: int, user_id: str) -> None:
        if not self.repository.delete_signal_for_user(signal_id, user_id):
            raise SignalNotFoundError

    def delete_all_for_user(self, user_id: str) -> int:
        return self.repository.delete_all_signals_for_user(user_id)
