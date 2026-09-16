"""Authenticated live-engine HTTP endpoints."""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.schemas.engine import EngineStart, EngineStatus
from app.services.engine_service import (
    EngineAccessDeniedError,
    EngineAlreadyRunningError,
    EngineNotRunningError,
    EngineService,
)
from app.services.rule_service import RuleNotFoundError
from app.services.watchlist_service import WatchlistNotFoundError


def create_engine_router(engine_service: EngineService) -> APIRouter:
    """Build engine routes using the application-owned service instance."""
    router = APIRouter(prefix="/api/engine", tags=["engine"])
    logger = logging.getLogger(__name__)

    @router.get("/status", response_model=EngineStatus)
    def get_engine_status(current_user=Depends(get_current_user)):
        try:
            return engine_service.get_status_for_user(str(current_user.id))
        except EngineAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Engine session belongs to another user",
            )
        except Exception as error:
            logger.error("Error getting engine status: %s", error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )

    @router.post("/start")
    async def start_engine(
        engine_config: EngineStart,
        background_tasks: BackgroundTasks,
        current_user=Depends(get_current_user),
    ):
        try:
            engine_service.start_for_user(
                watchlist_id=engine_config.watchlist_id,
                rule_id=engine_config.rule_id,
                demo=engine_config.demo,
                user_id=str(current_user.id),
                background_tasks=background_tasks,
            )
            return {"message": "Engine start initiated"}
        except EngineAlreadyRunningError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Engine is already running",
            )
        except (WatchlistNotFoundError, RuleNotFoundError):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Watchlist or rule not found",
            )
        except Exception as error:
            logger.error("Error starting engine: %s", error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )

    @router.post("/stop")
    def stop_engine(current_user=Depends(get_current_user)):
        try:
            engine_service.stop_for_user(str(current_user.id))
            return {"message": "Engine stop initiated"}
        except EngineNotRunningError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Engine is not running",
            )
        except EngineAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Engine session belongs to another user",
            )
        except Exception as error:
            logger.error("Error stopping engine: %s", error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )

    return router
