"""
In-memory log buffering and real-time broadcasting.

Keeps a rolling buffer of formatted log lines since process start (used to
serve the initial state of the "Application Logs" modal) and pushes each new
line to connected WebSocket clients in real time via the Socket.IO
broadcaster, once one is attached.
"""

import logging
import re
from collections import deque
from typing import Callable, Dict, Optional, Tuple


class UserContextLoggerAdapter(logging.LoggerAdapter):
    """Add the active Supabase user ID to records from one user process."""

    def __init__(
        self,
        logger: logging.Logger,
        user_id_provider: Callable[[], Optional[str]],
    ):
        super().__init__(logger, {})
        self.user_id_provider = user_id_provider

    def process(self, msg, kwargs) -> Tuple[object, dict]:
        extra = dict(kwargs.get("extra") or {})
        user_id = self.user_id_provider()
        if user_id:
            extra["user_id"] = str(user_id)
        kwargs["extra"] = extra
        return msg, kwargs


class InMemoryLogHandler(logging.Handler):
    """Logging handler that buffers formatted lines and broadcasts them live."""

    def __init__(self, capacity: int = 5000):
        super().__init__()
        self.capacity = capacity
        self.buffer = deque(maxlen=capacity)
        self.user_buffers: Dict[str, deque] = {}
        self.broadcaster = None

    def get_buffer_text(
        self,
        lines: Optional[int] = None,
        user_id: Optional[str] = None,
    ) -> str:
        source = self.buffer if user_id is None else self.user_buffers.get(user_id, ())
        entries = list(source)
        if lines is not None:
            entries = entries[-lines:]
        return ("\n".join(entries) + "\n") if entries else ""

    def get_user_line_count(self, user_id: str) -> int:
        return len(self.user_buffers.get(user_id, ()))

    @staticmethod
    def redact_sensitive_values(line: str) -> str:
        """Remove common credentials before any log is stored or emitted."""
        redacted = re.sub(
            r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+",
            r"\1[REDACTED]",
            line,
        )
        redacted = re.sub(
            r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+",
            r"\1[REDACTED]",
            redacted,
        )
        redacted = re.sub(
            r"(?i)(/bot)[^/\s]+(/sendMessage)",
            r"\1[REDACTED]\2",
            redacted,
        )
        redacted = re.sub(
            r"(?i)\b(token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+",
            r"\1=[REDACTED]",
            redacted,
        )
        redacted = re.sub(
            r"\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
            "[REDACTED_JWT]",
            redacted,
        )
        return redacted

    def emit(self, record: logging.LogRecord) -> None:
        try:
            line = self.format(record)
        except Exception:
            return

        line = self.redact_sensitive_values(line)
        self.buffer.append(line)

        user_id = str(getattr(record, "user_id", "") or "").strip()
        if not user_id:
            # System logs stay available to local diagnostics but are not
            # exposed through the user API or Socket.IO.
            return

        user_buffer = self.user_buffers.setdefault(
            user_id,
            deque(maxlen=self.capacity),
        )
        user_buffer.append(line)

        broadcaster = self.broadcaster
        if broadcaster is not None:
            try:
                broadcaster.broadcast_log_entry_sync(line, user_id)
            except Exception:
                pass


# Module-level singleton shared between main.py (attaches it to the root
# logger and later sets .broadcaster) and app.py (reads the buffer for the
# /api/logs endpoint).
log_handler = InMemoryLogHandler()


def attach_user_log_handler(broadcaster) -> None:
    """Attach the shared sanitized handler once for desktop or Docker runtime."""
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    log_handler.setFormatter(formatter)
    log_handler.broadcaster = broadcaster
    root_logger = logging.getLogger()
    if log_handler not in root_logger.handlers:
        root_logger.addHandler(log_handler)
    if root_logger.level > logging.INFO:
        root_logger.setLevel(logging.INFO)
