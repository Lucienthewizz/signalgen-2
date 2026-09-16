"""Public health metadata and authenticated detailed system status."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.schemas.system import SystemStatus
from app.services.engine_service import EngineAccessDeniedError
from app.services.system_service import SystemService


logger = logging.getLogger(__name__)


def create_system_router(system_service: SystemService) -> APIRouter:
    router = APIRouter(tags=["system"])

    @router.get("/api")
    def get_api_info():
        return system_service.get_api_info()

    @router.get("/api/health")
    def health_check():
        try:
            return system_service.get_health()
        except Exception as error:
            logger.error("Health check failed: %s", error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Service unavailable",
            )

    @router.get("/api/status", response_model=SystemStatus)
    def get_system_status(current_user=Depends(get_current_user)):
        try:
            return system_service.get_status_for_user(str(current_user.id))
        except EngineAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Engine session belongs to another user",
            )
        except Exception as error:
            logger.error("Error getting system status: %s", error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get system status",
            )

    return router
