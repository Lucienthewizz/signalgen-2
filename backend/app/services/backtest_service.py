"""Ownership boundary and persistence operations for backtests."""

from datetime import datetime
from typing import Dict, List, Optional

from app.data_sources import CachedDataSource, IBKRDataSource, YahooDataSource
from app.engines.backtesting_engine import BacktestingEngine
from app.schemas.backtests import BacktestRequest
from app.storage.sqlite_repo import SQLiteRepository


class BacktestNotFoundError(Exception):
    """Raised when a run is absent or belongs to another user."""


class BacktestService:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def get_rule_for_user(self, rule_id: int, user_id: str) -> Dict:
        rule = self.repository.get_rule_for_user(rule_id, user_id)
        if rule is None:
            raise BacktestNotFoundError
        return rule

    def create_screen_run(
        self,
        user_id: str,
        mode: str,
        timeframe: str,
        exit_strategy: str,
        row_count: int,
        config: Dict,
        summary: Optional[Dict] = None,
    ) -> int:
        return self.repository.create_backtest_screen_run(
            user_id=user_id,
            mode=mode,
            timeframe=timeframe,
            exit_strategy=exit_strategy,
            row_count=row_count,
            config=config,
            summary=summary,
        )

    def list_screen_runs(self, user_id: str, limit: int = 50) -> List[Dict]:
        return self.repository.get_backtest_screen_runs(
            user_id,
            limit=max(1, min(limit, 200)),
        )

    def get_screen_run(self, run_id: int, user_id: str) -> Dict:
        run = self.repository.get_backtest_screen_run(run_id, user_id)
        if run is None:
            raise BacktestNotFoundError
        return run

    def delete_screen_run(self, run_id: int, user_id: str) -> None:
        if not self.repository.delete_backtest_screen_run(run_id, user_id):
            raise BacktestNotFoundError

    def delete_all_screen_runs(self, user_id: str) -> int:
        return self.repository.delete_all_backtest_screen_runs(user_id)

    async def run(self, request: BacktestRequest, user_id: str) -> Dict:
        # Resolve the rule through the ownership-aware query before doing any
        # market-data work. A foreign rule is indistinguishable from missing.
        self.get_rule_for_user(request.rule_id, user_id)
        start_date = datetime.fromisoformat(request.start_date.replace("Z", "+00:00"))
        end_date = datetime.fromisoformat(request.end_date.replace("Z", "+00:00"))
        if end_date <= start_date:
            raise ValueError("end_date must be later than start_date")

        if request.data_source == "ibkr":
            data_source = IBKRDataSource()
        else:
            data_source = CachedDataSource(
                YahooDataSource(),
                self.repository,
                data_source_name="yahoo",
            )

        engine = BacktestingEngine(
            data_source=data_source,
            timeframe=request.timeframe,
            repository=self.repository,
        )
        return await engine.run_backtest(
            name=request.name,
            mode=request.mode,
            symbols=request.symbols,
            rule_id=request.rule_id,
            start_date=start_date,
            end_date=end_date,
            data_source_name=request.data_source,
            user_id=user_id,
        )

    def list_runs(self, user_id: str) -> List[Dict]:
        return self.repository.get_all_backtest_runs(user_id)

    def get_run(self, run_id: int, user_id: str) -> Dict:
        run = self.repository.get_backtest_run(run_id, user_id)
        if run is None:
            raise BacktestNotFoundError
        run["signals"] = self.repository.get_backtest_signals(run_id, user_id)
        return run

    def delete_run(self, run_id: int, user_id: str) -> None:
        if not self.repository.delete_backtest_run(run_id, user_id):
            raise BacktestNotFoundError
