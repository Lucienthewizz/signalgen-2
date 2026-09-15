"""Business logic and ownership checks for watchlists."""

from typing import Dict, List, Optional

from app.storage.sqlite_repo import SQLiteRepository


class WatchlistNotFoundError(Exception):
    """Raised when a watchlist is unavailable to the current user."""


class WatchlistService:
    """Coordinate persistence and per-user access to watchlists."""

    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def list_for_user(self, user_id: str) -> List[Dict]:
        return self.repository.get_watchlists_for_user(user_id)

    def get_for_user(self, watchlist_id: int, user_id: str) -> Dict:
        watchlist = self.repository.get_watchlist_for_user(watchlist_id, user_id)
        if watchlist is None:
            raise WatchlistNotFoundError
        return watchlist

    def create_for_user(
        self,
        name: str,
        symbols: List[str],
        user_id: str,
    ) -> Dict:
        watchlist_id = self.repository.create_watchlist(
            name=name,
            symbols=symbols,
            user_id=user_id,
        )
        return self.get_for_user(watchlist_id, user_id)

    def update_for_user(
        self,
        watchlist_id: int,
        user_id: str,
        name: Optional[str] = None,
        symbols: Optional[List[str]] = None,
    ) -> Dict:
        self.get_for_user(watchlist_id, user_id)
        update_data = {
            key: value
            for key, value in {"name": name, "symbols": symbols}.items()
            if value is not None
        }
        if update_data and not self.repository.update_watchlist_for_user(
            watchlist_id,
            user_id,
            update_data,
        ):
            raise WatchlistNotFoundError
        return self.get_for_user(watchlist_id, user_id)

    def delete_for_user(self, watchlist_id: int, user_id: str) -> None:
        if not self.repository.delete_watchlist_for_user(watchlist_id, user_id):
            raise WatchlistNotFoundError

    def activate_for_user(self, watchlist_id: int, user_id: str) -> Dict:
        if not self.repository.set_active_watchlist_for_user(
            watchlist_id,
            user_id,
        ):
            raise WatchlistNotFoundError
        return self.get_for_user(watchlist_id, user_id)
