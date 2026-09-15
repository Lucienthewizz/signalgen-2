"""Business logic and ownership checks for ticker universes."""

from typing import Dict, List, Optional

from app.storage.sqlite_repo import SQLiteRepository


class UniverseNotFoundError(Exception):
    """Raised when a universe is unavailable to the current user."""


class UniverseNameConflictError(Exception):
    """Raised when one user reuses an existing personal universe name."""


class UniverseService:
    """Coordinate ticker-universe persistence and per-user access."""

    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def list_for_user(self, user_id: str) -> List[Dict]:
        return self.repository.get_ticker_universes_for_user(user_id)

    def get_for_user(self, universe_id: int, user_id: str) -> Dict:
        universe = self.repository.get_ticker_universe_for_user(
            universe_id,
            user_id,
        )
        if universe is None:
            raise UniverseNotFoundError
        return universe

    def create_for_user(
        self,
        name: str,
        tickers: List[str],
        description: Optional[str],
        user_id: str,
    ) -> Dict:
        try:
            universe_id = self.repository.create_ticker_universe(
                name=name,
                tickers=tickers,
                description=description,
                user_id=user_id,
            )
        except Exception as error:
            if "UNIQUE constraint failed" in str(error):
                raise UniverseNameConflictError from error
            raise
        return self.get_for_user(universe_id, user_id)

    def update_for_user(
        self,
        universe_id: int,
        user_id: str,
        name: Optional[str] = None,
        tickers: Optional[List[str]] = None,
        description: Optional[str] = None,
    ) -> Dict:
        existing = self.get_for_user(universe_id, user_id)
        if existing.get("is_system"):
            raise UniverseNotFoundError

        try:
            updated = self.repository.update_ticker_universe_for_user(
                universe_id=universe_id,
                user_id=user_id,
                name=name,
                tickers=tickers,
                description=description,
            )
        except Exception as error:
            if "UNIQUE constraint failed" in str(error):
                raise UniverseNameConflictError from error
            raise
        if not updated:
            raise UniverseNotFoundError
        return self.get_for_user(universe_id, user_id)

    def delete_for_user(self, universe_id: int, user_id: str) -> None:
        if not self.repository.delete_ticker_universe_for_user(
            universe_id,
            user_id,
        ):
            raise UniverseNotFoundError
