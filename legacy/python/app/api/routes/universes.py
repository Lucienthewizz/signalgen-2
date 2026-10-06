"""System and user-owned ticker-universe HTTP endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.schemas.universes import UniverseCreate, UniverseUpdate
from app.services.universe_service import (
    UniverseNameConflictError,
    UniverseNotFoundError,
    UniverseService,
)


logger = logging.getLogger(__name__)


def create_universes_router(universe_service: UniverseService) -> APIRouter:
    """Build ticker-universe routes using application-owned dependencies."""
    router = APIRouter(prefix="/api/swing/universes", tags=["swing"])

    @router.get("")
    def get_ticker_universes(current_user=Depends(get_current_user)):
        try:
            return {
                "universes": universe_service.list_for_user(
                    str(current_user.id)
                )
            }
        except Exception as error:
            logger.error("Error getting ticker universes: %s", error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.get("/{universe_id}")
    def get_ticker_universe(
        universe_id: int,
        current_user=Depends(get_current_user),
    ):
        try:
            return universe_service.get_for_user(
                universe_id,
                str(current_user.id),
            )
        except UniverseNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Ticker universe {universe_id} not found",
            )
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error getting ticker universe %s: %s", universe_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.post("")
    def create_ticker_universe(
        request: UniverseCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            universe = universe_service.create_for_user(
                name=request.name,
                tickers=request.tickers,
                description=request.description,
                user_id=str(current_user.id),
            )
            return {
                "message": "Ticker universe created successfully",
                "universe_id": universe["id"],
            }
        except UniverseNameConflictError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Universe with name '{request.name}' already exists",
            )
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error creating ticker universe: %s", error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.put("/{universe_id}")
    def update_ticker_universe(
        universe_id: int,
        request: UniverseUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            universe_service.update_for_user(
                universe_id=universe_id,
                user_id=str(current_user.id),
                name=request.name,
                tickers=request.tickers,
                description=request.description,
            )
            return {"message": "Ticker universe updated successfully"}
        except UniverseNameConflictError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Universe with name '{request.name}' already exists",
            )
        except UniverseNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Ticker universe {universe_id} not found",
            )
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error updating ticker universe %s: %s", universe_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.delete("/{universe_id}")
    def delete_ticker_universe(
        universe_id: int,
        current_user=Depends(get_current_user),
    ):
        try:
            universe_service.delete_for_user(
                universe_id,
                str(current_user.id),
            )
            return {"message": "Ticker universe deleted successfully"}
        except UniverseNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Ticker universe {universe_id} not found",
            )
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error deleting ticker universe %s: %s", universe_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    return router
