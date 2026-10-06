"""Request and response models for private Telegram configuration."""

from typing import Optional

from pydantic import BaseModel, Field


class TelegramSettingsUpdate(BaseModel):
    bot_token: Optional[str] = Field(None, description="BotFather token")
    chat_ids: Optional[str] = Field(None, description="Comma-separated chat IDs")
    enabled: Optional[bool] = None


class TelegramTestRequest(BaseModel):
    chat_id: Optional[str] = None
