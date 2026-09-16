"""Authorization tests for settings and Telegram configuration."""

import asyncio
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.app import SignalGenApp
from app.auth.dependencies import get_current_user
from app.notifications.telegram_notifier import TelegramNotifier


@pytest.fixture
def authorized_settings_app(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "authorized-settings.db"))
    identity = {"id": "user-a"}

    def override_current_user():
        return SimpleNamespace(
            id=identity["id"],
            email=f"{identity['id']}@example.com",
            user_metadata={},
        )

    signalgen.app.dependency_overrides[get_current_user] = override_current_user
    with TestClient(signalgen.app) as client:
        yield signalgen, client, identity
    signalgen.app.dependency_overrides.clear()


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/api/settings", None),
        ("get", "/api/settings/ui_theme", None),
        ("put", "/api/settings/ui_theme", {"value": "dark"}),
        ("get", "/api/timeframes", None),
        ("put", "/api/timeframe", {"value": "5m"}),
        ("get", "/api/mode", None),
        ("put", "/api/mode", {"mode": "swing"}),
        ("get", "/api/telegram/settings", None),
        ("put", "/api/telegram/settings", {"enabled": True}),
        ("post", "/api/telegram/test", {}),
    ],
)
def test_personal_settings_endpoints_require_authentication(
    tmp_path, method, path, body
):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized-settings.db"))
    with TestClient(signalgen.app) as client:
        response = client.request(method, path, json=body)
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_regular_settings_are_isolated_by_owner(authorized_settings_app):
    _, client, identity = authorized_settings_app

    assert client.put(
        "/api/settings/ui_theme", json={"value": "dark"}
    ).status_code == 200
    assert client.get("/api/settings/ui_theme").json()["value"] == "dark"

    identity["id"] = "user-b"
    assert client.get("/api/settings/ui_theme").json()["value"] == "light"
    assert client.get("/api/settings").json()["ui_theme"] == "light"

    identity["id"] = "user-a"
    assert client.get("/api/settings/ui_theme").json()["value"] == "dark"


def test_timeframe_is_stored_per_user_and_applied_to_engine(
    authorized_settings_app,
):
    signalgen, client, identity = authorized_settings_app

    assert client.put("/api/timeframe", json={"value": "5m"}).status_code == 200
    assert client.get("/api/timeframes").json()["current"] == "5m"

    identity["id"] = "user-b"
    assert client.get("/api/timeframes").json()["current"] == "1m"
    signalgen.settings_service.apply_timeframe_for_user("user-b")
    assert signalgen.scalping_engine.get_timeframe() == "1m"

    signalgen.settings_service.apply_timeframe_for_user("user-a")
    assert signalgen.scalping_engine.get_timeframe() == "5m"


def test_operational_mode_is_stored_per_user(authorized_settings_app):
    _, client, identity = authorized_settings_app

    response = client.put("/api/mode", json={"mode": "swing"})
    assert response.status_code == 200
    assert client.get("/api/mode").json()["mode"] == "swing"

    identity["id"] = "user-b"
    assert client.get("/api/mode").json()["mode"] == "scalping"


def test_public_health_exposes_only_minimum_runtime_status(
    authorized_settings_app,
):
    _, client, _ = authorized_settings_app

    response = client.get("/api/health")

    assert response.status_code == 200
    assert set(response.json()) == {"status", "timestamp", "version", "engine"}
    assert set(response.json()["engine"]) == {"is_running"}


def test_telegram_credentials_are_private_and_masked(authorized_settings_app):
    signalgen, client, identity = authorized_settings_app
    signalgen.repository.set_setting("telegram_bot_token", "legacy-global-secret")

    saved = client.put(
        "/api/telegram/settings",
        json={
            "bot_token": "123456789:private-user-a-token",
            "chat_ids": "111,222",
            "enabled": True,
        },
    )
    assert saved.status_code == 200

    user_a = client.get("/api/telegram/settings").json()
    assert user_a["bot_token"].startswith("...")
    assert "private-user-a-token" not in user_a["bot_token"]
    assert user_a["chat_ids"] == "111,222"
    assert user_a["enabled"] is True

    identity["id"] = "user-b"
    user_b = client.get("/api/telegram/settings").json()
    assert user_b == {
        "bot_token": "",
        "chat_ids": "",
        "enabled": False,
        "token_configured": False,
        "chat_ids_configured": False,
    }


def test_telegram_test_uses_authenticated_user(authorized_settings_app):
    signalgen, client, _ = authorized_settings_app
    signalgen.repository.set_user_setting(
        "user-a", "telegram_bot_token", "private-token"
    )
    seen = {}

    async def fake_send_test(user_id, chat_id=None):
        seen.update(user_id=user_id, chat_id=chat_id)

    signalgen.telegram_service.send_test = fake_send_test
    response = client.post("/api/telegram/test", json={"chat_id": "123"})

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert seen == {"user_id": "user-a", "chat_id": "123"}


def test_user_settings_table_has_composite_owner_key(authorized_settings_app):
    signalgen, _, _ = authorized_settings_app
    signalgen.repository.set_user_setting("user-a", "ui_theme", "dark")
    signalgen.repository.set_user_setting("user-b", "ui_theme", "light")

    with sqlite3.connect(signalgen.repository.db_path) as connection:
        rows = connection.execute(
            "SELECT user_id, value FROM user_settings WHERE key = 'ui_theme' ORDER BY user_id"
        ).fetchall()

    assert rows == [("user-a", "dark"), ("user-b", "light")]


def test_signal_notification_loads_its_owners_telegram_credentials(
    authorized_settings_app,
):
    signalgen, _, _ = authorized_settings_app
    repository = signalgen.repository
    repository.set_user_setting("user-a", "telegram_bot_token", "token-a")
    repository.set_user_setting("user-a", "telegram_chat_ids", "chat-a")
    repository.set_user_setting("user-a", "telegram_enabled", True)
    repository.set_user_setting("user-b", "telegram_bot_token", "token-b")
    repository.set_user_setting("user-b", "telegram_chat_ids", "chat-b")
    repository.set_user_setting("user-b", "telegram_enabled", True)

    delivered = []
    notifier = TelegramNotifier(repository)

    async def fake_send_message(chat_id, message, bot_token=None):
        delivered.append((chat_id, bot_token))
        return True

    notifier._send_message = fake_send_message
    sent = asyncio.run(
        notifier.send_signal(
            {
                "user_id": "user-b",
                "symbol": "BBCA",
                "price": 9000,
                "rule_id": None,
                "timestamp": "2026-09-15T10:00:00",
            }
        )
    )

    assert sent is True
    assert delivered == [("chat-b", "token-b")]
