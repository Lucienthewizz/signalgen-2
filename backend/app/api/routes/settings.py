"""Authenticated routes for per-user application preferences."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.schemas.settings import ModeChange, SettingsResponse, SettingsUpdate
from app.services.settings_service import (
    EngineBusyError,
    InvalidSettingError,
    SettingsService,
)


def create_settings_router(settings_service: SettingsService, broadcaster) -> APIRouter:
    router = APIRouter(tags=["settings"])

    @router.get("/api/settings")
    def get_all_settings(current_user=Depends(get_current_user)):
        return settings_service.get_all_for_user(str(current_user.id))

    @router.get("/api/settings/{key}", response_model=SettingsResponse)
    def get_setting(key: str, current_user=Depends(get_current_user)):
        try:
            return {"key": key, "value": settings_service.get_for_user(str(current_user.id), key)}
        except InvalidSettingError as error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))

    @router.put("/api/settings/{key}")
    async def set_setting(
        key: str,
        setting_update: SettingsUpdate,
        current_user=Depends(get_current_user),
    ):
        user_id = str(current_user.id)
        try:
            settings_service.set_for_user(user_id, key, setting_update.value)
            asyncio.create_task(
                broadcaster.broadcast_error(
                    {
                        "type": "setting_update",
                        "message": f"Setting {key} updated",
                        "data": {"key": key, "value": setting_update.value},
                    },
                    user_id=user_id,
                )
            )
            return {"message": "Setting updated successfully"}
        except InvalidSettingError as error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))

    @router.get("/api/timeframes")
    def get_available_timeframes(current_user=Depends(get_current_user)):
        user_id = str(current_user.id)
        return {
            "timeframes": settings_service.supported_timeframes(),
            "current": settings_service.get_for_user(user_id, "timeframe"),
        }

    @router.put("/api/timeframe")
    async def change_timeframe(
        setting_update: SettingsUpdate,
        current_user=Depends(get_current_user),
    ):
        user_id = str(current_user.id)
        try:
            timeframe = settings_service.change_timeframe_for_user(
                user_id, setting_update.value
            )
            asyncio.create_task(
                broadcaster.broadcast_error(
                    {
                        "type": "timeframe_change",
                        "message": f"Timeframe changed to {timeframe}",
                        "data": {"timeframe": timeframe},
                    },
                    user_id=user_id,
                )
            )
            return {"message": "Timeframe changed successfully", "timeframe": timeframe}
        except (InvalidSettingError, EngineBusyError, RuntimeError) as error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))

    @router.get("/api/mode")
    def get_current_mode(current_user=Depends(get_current_user)):
        user_id = str(current_user.id)
        return {
            "mode": settings_service.get_for_user(
                user_id,
                "operational_mode",
            ),
            "available_modes": [
                "scalping",
                "backtesting",
                "swing",
                "swing_backtest",
            ],
            "engine_running": settings_service.scalping_engine.is_running,
        }

    @router.put("/api/mode")
    def change_mode(
        request: ModeChange,
        current_user=Depends(get_current_user),
    ):
        try:
            mode = settings_service.change_mode_for_user(
                str(current_user.id),
                request.mode,
            )
            return {"message": f"Mode changed to {mode}", "mode": mode}
        except (InvalidSettingError, EngineBusyError) as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            )

    return router
