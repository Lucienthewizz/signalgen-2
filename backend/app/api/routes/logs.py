"""Authenticated endpoint for private, sanitized application activity logs."""

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import get_current_user
from app.services.log_service import LogService


def create_logs_router(log_service: LogService) -> APIRouter:
    router = APIRouter(prefix="/api/logs", tags=["logs"])

    @router.get("")
    def get_logs(
        lines: int = Query(2000, ge=1, le=5000),
        current_user=Depends(get_current_user),
    ):
        return log_service.get_for_user(str(current_user.id), lines)

    return router
