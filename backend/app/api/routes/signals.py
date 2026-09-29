"""Authenticated endpoints for user-owned trading signals."""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth.dependencies import get_current_user
from app.schemas.signals import SignalResponse
from app.services.signal_service import SignalNotFoundError, SignalService


def create_signals_router(signal_service: SignalService) -> APIRouter:
    """Build signal routes using the application-owned service instance."""
    router = APIRouter(prefix="/api/signals", tags=["signals"])
    logger = logging.getLogger(__name__)

    @router.get("", response_model=List[SignalResponse])
    def get_signals(
        limit: int = Query(default=100, ge=1, le=500),
        symbol: Optional[str] = None,
        current_user=Depends(get_current_user),
    ):
        try:
            return signal_service.list_for_user(
                user_id=str(current_user.id),
                limit=limit,
                symbol=symbol,
            )
        except Exception as error:
            logger.error("Error getting signals: %s", error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )

    @router.delete("")
    def delete_all_signals(current_user=Depends(get_current_user)):
        try:
            deleted = signal_service.delete_all_for_user(
                str(current_user.id)
            )
            return {"message": "All signals cleared", "deleted": deleted}
        except Exception as error:
            logger.error("Error clearing signals: %s", error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )

    @router.delete("/{signal_id}")
    def delete_signal(
        signal_id: int,
        current_user=Depends(get_current_user),
    ):
        try:
            signal_service.delete_for_user(
                signal_id,
                str(current_user.id),
            )
            return {"message": "Signal deleted successfully"}
        except SignalNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Signal not found",
            )
        except Exception as error:
            logger.error("Error deleting signal %s: %s", signal_id, error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )

    return router
