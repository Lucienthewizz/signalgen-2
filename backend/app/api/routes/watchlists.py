"""User-owned watchlist HTTP endpoints."""

import logging
from typing import Callable, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.auth.dependencies import get_current_user
from app.schemas.watchlists import WatchlistCreate, WatchlistUpdate
from app.services.watchlist_service import (
    WatchlistNotFoundError,
    WatchlistService,
)


logger = logging.getLogger(__name__)


def create_watchlists_router(
    watchlist_service: WatchlistService,
    engine_is_running: Callable[[], bool],
) -> APIRouter:
    """Build watchlist routes using application-owned dependencies."""
    router = APIRouter(prefix="/api/watchlists", tags=["watchlists"])

    @router.get("", response_model=List[Dict])
    def get_all_watchlists(current_user=Depends(get_current_user)):
        try:
            return JSONResponse(
                content=watchlist_service.list_for_user(str(current_user.id))
            )
        except Exception as error:
            logger.error("Error getting watchlists: %s", error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.get("/{watchlist_id}", response_model=Dict)
    def get_watchlist(
        watchlist_id: int,
        current_user=Depends(get_current_user),
    ):
        try:
            return JSONResponse(
                content=watchlist_service.get_for_user(
                    watchlist_id,
                    str(current_user.id),
                )
            )
        except WatchlistNotFoundError:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error getting watchlist %s: %s", watchlist_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.post("", response_model=Dict)
    def create_watchlist(
        watchlist: WatchlistCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            created = watchlist_service.create_for_user(
                name=watchlist.name,
                symbols=watchlist.symbols,
                user_id=str(current_user.id),
            )
            return JSONResponse(content=created, status_code=201)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error creating watchlist: %s", error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.put("/{watchlist_id}", response_model=Dict)
    def update_watchlist(
        watchlist_id: int,
        watchlist: WatchlistUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            if engine_is_running():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot modify watchlist while engine is running",
                )

            updated = watchlist_service.update_for_user(
                watchlist_id=watchlist_id,
                user_id=str(current_user.id),
                name=watchlist.name,
                symbols=watchlist.symbols,
            )
            return JSONResponse(content=updated)
        except WatchlistNotFoundError:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error updating watchlist %s: %s", watchlist_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.delete("/{watchlist_id}")
    def delete_watchlist(
        watchlist_id: int,
        current_user=Depends(get_current_user),
    ):
        try:
            if engine_is_running():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot delete watchlist while engine is running",
                )

            watchlist_service.delete_for_user(
                watchlist_id,
                str(current_user.id),
            )
            return {"message": "Watchlist deleted successfully"}
        except WatchlistNotFoundError:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error deleting watchlist %s: %s", watchlist_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.put("/{watchlist_id}/activate")
    def activate_watchlist(
        watchlist_id: int,
        current_user=Depends(get_current_user),
    ):
        try:
            if engine_is_running():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot activate watchlist while engine is running",
                )

            watchlist_service.activate_for_user(
                watchlist_id,
                str(current_user.id),
            )
            return {"message": "Watchlist activated successfully"}
        except WatchlistNotFoundError:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error activating watchlist %s: %s", watchlist_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    return router
