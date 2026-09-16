"""Authenticated routes for private Telegram notification settings."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.schemas.telegram import TelegramSettingsUpdate, TelegramTestRequest
from app.services.telegram_service import (
    TelegramDeliveryError,
    TelegramNotConfiguredError,
    TelegramService,
)


def create_telegram_router(telegram_service: TelegramService) -> APIRouter:
    router = APIRouter(prefix="/api/telegram", tags=["telegram"])

    @router.get("/settings")
    def get_telegram_settings(current_user=Depends(get_current_user)):
        return telegram_service.get_for_user(str(current_user.id))

    @router.put("/settings")
    def update_telegram_settings(
        update: TelegramSettingsUpdate,
        current_user=Depends(get_current_user),
    ):
        settings = telegram_service.update_for_user(str(current_user.id), update)
        return {
            "message": "Telegram settings updated successfully",
            "enabled": settings["enabled"],
        }

    @router.post("/test")
    async def test_telegram_notification(
        request: TelegramTestRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            await telegram_service.send_test(str(current_user.id), request.chat_id)
            return {"message": "Test message sent successfully", "success": True}
        except TelegramNotConfiguredError as error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
        except TelegramDeliveryError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(error),
            )

    return router
