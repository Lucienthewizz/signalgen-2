"""Business logic for private per-user Telegram configuration."""

from typing import Any, Dict, Optional

from app.notifications.telegram_notifier import TelegramNotifier
from app.schemas.telegram import TelegramSettingsUpdate
from app.storage.sqlite_repo import SQLiteRepository


class TelegramNotConfiguredError(ValueError):
    pass


class TelegramDeliveryError(RuntimeError):
    pass


class TelegramService:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    @staticmethod
    def _as_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    def get_for_user(self, user_id: str) -> Dict[str, Any]:
        token = self.repository.get_user_setting(user_id, "telegram_bot_token", "")
        chat_ids = self.repository.get_user_setting(user_id, "telegram_chat_ids", "")
        enabled = self._as_bool(
            self.repository.get_user_setting(user_id, "telegram_enabled", False)
        )
        token_text = str(token or "")
        masked_token = ""
        if token_text:
            masked_token = "..." + token_text[-4:] if len(token_text) > 8 else "***"
        return {
            "bot_token": masked_token,
            "chat_ids": str(chat_ids or ""),
            "enabled": enabled,
            "token_configured": bool(token_text.strip()),
            "chat_ids_configured": bool(str(chat_ids or "").strip()),
        }

    def update_for_user(
        self,
        user_id: str,
        update: TelegramSettingsUpdate,
    ) -> Dict[str, Any]:
        if (
            update.bot_token is not None
            and update.bot_token != "***"
            and not update.bot_token.startswith("...")
        ):
            self.repository.set_user_setting(
                user_id, "telegram_bot_token", update.bot_token.strip()
            )
        if update.chat_ids is not None:
            self.repository.set_user_setting(
                user_id, "telegram_chat_ids", update.chat_ids.strip()
            )
        if update.enabled is not None:
            self.repository.set_user_setting(
                user_id, "telegram_enabled", update.enabled
            )
        return self.get_for_user(user_id)

    async def send_test(self, user_id: str, chat_id: Optional[str] = None) -> None:
        token = self.repository.get_user_setting(user_id, "telegram_bot_token")
        if not token:
            raise TelegramNotConfiguredError("Telegram bot token not configured")
        notifier = TelegramNotifier(self.repository)
        await notifier.initialize(user_id)
        if not await notifier.send_test_message(chat_id):
            raise TelegramDeliveryError(
                "Failed to send test message. Check bot token and chat ID."
            )
