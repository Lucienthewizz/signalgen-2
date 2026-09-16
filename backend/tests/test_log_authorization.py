"""Authorization, isolation, and secret-redaction tests for user logs."""

import secrets
import logging
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.app import SignalGenApp
from app.auth.dependencies import get_current_user
from app.logging_utils import InMemoryLogHandler, UserContextLoggerAdapter


@pytest.fixture
def authorized_log_app(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "authorized-logs.db"))
    identity = {"id": "user-a"}

    def override_current_user():
        return SimpleNamespace(
            id=identity["id"],
            email=f"{identity['id']}@example.com",
            user_metadata={},
        )

    handler = InMemoryLogHandler(capacity=20)
    handler.setFormatter(logging.Formatter("%(levelname)s - %(message)s"))
    signalgen.log_service.handler = handler
    signalgen.app.dependency_overrides[get_current_user] = override_current_user

    with TestClient(signalgen.app) as client:
        yield client, identity, handler

    signalgen.app.dependency_overrides.clear()


def _isolated_logger(handler):
    logger = logging.getLogger(f"test.user.logs.{id(handler)}")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


def test_log_endpoint_requires_authentication(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized-logs.db"))

    with TestClient(signalgen.app) as client:
        response = client.get("/api/logs")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_log_history_is_isolated_by_owner(authorized_log_app):
    client, identity, handler = authorized_log_app
    logger = _isolated_logger(handler)
    logger.info("user A operation", extra={"user_id": "user-a"})
    logger.info("user B operation", extra={"user_id": "user-b"})
    logger.info("server-only operation")

    user_a = client.get("/api/logs")
    assert user_a.status_code == 200
    assert "user A operation" in user_a.json()["content"]
    assert "user B operation" not in user_a.json()["content"]
    assert "server-only operation" not in user_a.json()["content"]
    assert user_a.json()["line_count"] == 1

    identity["id"] = "user-b"
    user_b = client.get("/api/logs")
    assert "user B operation" in user_b.json()["content"]
    assert "user A operation" not in user_b.json()["content"]
    assert "server-only operation" not in user_b.json()["content"]


def test_secrets_are_redacted_before_storage_and_broadcast():
    handler = InMemoryLogHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    handler.broadcaster = Mock()
    logger = _isolated_logger(handler)
    test_password = secrets.token_urlsafe(24)
    secret_jwt = "abcdefgh.ijklmnop.qrstuvwx"

    logger.info(
        f"Authorization: Bearer access-secret password={test_password} "
        "https://api.telegram.org/bot123456:bot-secret/sendMessage "
        "jwt=%s",
        secret_jwt,
        extra={"user_id": "user-a"},
    )

    stored = handler.get_buffer_text(user_id="user-a")
    assert "access-secret" not in stored
    assert test_password not in stored
    assert "bot-secret" not in stored
    assert secret_jwt not in stored
    assert "[REDACTED]" in stored
    handler.broadcaster.broadcast_log_entry_sync.assert_called_once_with(
        stored.rstrip("\n"),
        "user-a",
    )


def test_system_logs_are_not_broadcast_to_users():
    handler = InMemoryLogHandler()
    handler.broadcaster = Mock()
    logger = _isolated_logger(handler)

    logger.info("server-only operation")

    handler.broadcaster.broadcast_log_entry_sync.assert_not_called()
    assert handler.get_buffer_text(user_id="user-a") == ""


def test_user_context_adapter_tags_active_engine_logs():
    handler = InMemoryLogHandler()
    logger = _isolated_logger(handler)
    identity = {"id": "user-a"}
    adapter = UserContextLoggerAdapter(logger, lambda: identity["id"])

    adapter.info("engine activity")

    assert "engine activity" in handler.get_buffer_text(user_id="user-a")
    assert handler.get_buffer_text(user_id="user-b") == ""
