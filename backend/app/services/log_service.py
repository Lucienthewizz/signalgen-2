"""Read-only access to sanitized logs owned by one user."""

from app.logging_utils import InMemoryLogHandler


class LogService:
    def __init__(self, handler: InMemoryLogHandler):
        self.handler = handler

    def get_for_user(self, user_id: str, lines: int) -> dict:
        return {
            "content": self.handler.get_buffer_text(lines, user_id=user_id),
            "line_count": self.handler.get_user_line_count(user_id),
        }
