"""Authorized swing-screening and Yahoo cache endpoints."""

import logging
import time
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.data_sources import CachedDataSource, YahooDataSource
from app.engines.swing_screening_engine import SwingScreeningEngine
from app.schemas.swing import SwingScreenRequest, YahooBackfillRequest
from app.services.rule_service import RuleNotFoundError, RuleService
from app.services.swing_chart_service import SwingChartService
from app.services.universe_service import UniverseNotFoundError, UniverseService
from app.storage.sqlite_repo import SQLiteRepository


logger = logging.getLogger(__name__)


def _parse_optional_datetime(
    value: Optional[str],
    field_name: str,
) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception as error:
        raise ValueError(f"Invalid {field_name}: {value}") from error
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def create_swing_router(
    repository: SQLiteRepository,
    rule_service: RuleService,
    universe_service: UniverseService,
    chart_service: SwingChartService,
) -> APIRouter:
    """Build swing routes with ownership-aware application dependencies."""
    router = APIRouter(prefix="/api/swing", tags=["swing"])

    @router.get("/chart")
    async def get_swing_chart(
        symbol: str,
        timeframe: str,
        timestamp: str,
        rule_id: int,
        before: int = 80,
        after: int = 40,
        current_user=Depends(get_current_user),
    ):
        request_id = str(uuid4())
        try:
            return await chart_service.build(
                symbol=symbol,
                timeframe=timeframe,
                timestamp=timestamp,
                rule_id=rule_id,
                user_id=str(current_user.id),
                before=before,
                after=after,
            )
        except RuleNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Rule not found",
            )
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            )
        except HTTPException:
            raise
        except Exception as error:
            logger.exception(
                "Swing chart error (request_id=%s): %s",
                request_id,
                error,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Swing chart failed due to an internal error. "
                    f"request_id={request_id}"
                ),
            )

    @router.post("/screen")
    async def screen_swing_signals(
        request: SwingScreenRequest,
        current_user=Depends(get_current_user),
    ):
        request_id = str(uuid4())
        try:
            user_id = str(current_user.id)
            rule = rule_service.get_for_user(request.rule_id, user_id)
            universe = universe_service.get_for_user(
                request.ticker_universe_id,
                user_id,
            )

            start_date = _parse_optional_datetime(request.start_date, "start_date")
            end_date = _parse_optional_datetime(request.end_date, "end_date")
            if bool(start_date) != bool(end_date):
                raise ValueError("start_date and end_date must be provided together")
            if start_date and end_date and end_date <= start_date:
                raise ValueError("end_date must be later than start_date")

            engine = SwingScreeningEngine(
                timeframe=request.timeframe,
                repository=repository,
            )
            start_time = time.perf_counter()
            logger.info(
                "Starting swing screening on universe %s for user %s",
                request.ticker_universe_id,
                user_id,
            )
            results = await engine.screen_tickers(
                tickers=universe.get("tickers", []),
                rule_id=request.rule_id,
                rule=rule,
                lookback_days=request.lookback_days,
                start_date=start_date,
                end_date=end_date,
            )

            successful = [result for result in results if result["status"] == "success"]
            signals_found = [
                result
                for result in successful
                if result["signal"] is not None
            ]
            no_data = [
                result
                for result in results
                if "no data available"
                in (result.get("error_message") or "").lower()
            ]
            duration_ms = int((time.perf_counter() - start_time) * 1000)
            return {
                "message": "Screening completed successfully",
                "request_id": request_id,
                "results": results,
                "summary": {
                    "total_tickers": len(results),
                    "successful": len(successful),
                    "signals_found": len(signals_found),
                    "errors": len(results) - len(successful),
                    "no_data": len(no_data),
                    "duration_ms": duration_ms,
                    "screening_start": (
                        start_date.isoformat() if start_date else None
                    ),
                    "screening_end": end_date.isoformat() if end_date else None,
                    "lookback_days": (
                        request.lookback_days if not start_date else None
                    ),
                },
            }
        except (RuleNotFoundError, UniverseNotFoundError):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Rule or ticker universe not found",
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except HTTPException:
            raise
        except Exception as error:
            logger.exception(
                "Screening error (request_id=%s): %s",
                request_id,
                error,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Screening failed due to an internal error. "
                    f"request_id={request_id}"
                ),
            )

    @router.post("/backfill-yahoo-cache")
    async def backfill_yahoo_cache(
        request: YahooBackfillRequest,
        current_user=Depends(get_current_user),
    ):
        request_id = str(uuid4())
        try:
            user_id = str(current_user.id)
            universe = universe_service.get_for_user(
                request.ticker_universe_id,
                user_id,
            )

            supported_timeframes = {"1m", "5m", "15m", "1h", "4h", "1d"}
            timeframes = []
            for timeframe in request.timeframes or ["1d"]:
                if timeframe not in supported_timeframes:
                    raise ValueError(f"Unsupported timeframe: {timeframe}")
                if timeframe not in timeframes:
                    timeframes.append(timeframe)

            start_date = _parse_optional_datetime(request.start_date, "start_date")
            end_date = _parse_optional_datetime(request.end_date, "end_date")
            if start_date and end_date and start_date >= end_date:
                raise ValueError("start_date must be before end_date")

            data_source = CachedDataSource(
                YahooDataSource(),
                repository,
                data_source_name="yahoo",
            )
            summary = await data_source.backfill_symbols(
                symbols=universe.get("tickers", []),
                timeframes=timeframes,
                start_date=start_date,
                end_date=end_date,
            )
            summary["universe_id"] = request.ticker_universe_id
            summary["universe_name"] = universe.get("name")
            return summary
        except UniverseNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ticker universe not found",
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except HTTPException:
            raise
        except Exception as error:
            logger.exception(
                "Yahoo cache backfill error (request_id=%s): %s",
                request_id,
                error,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Yahoo cache backfill failed due to an internal error. "
                    f"request_id={request_id}"
                ),
            )

    return router
