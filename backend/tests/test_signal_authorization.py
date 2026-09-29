"""Authorization and migration tests for generated signals."""

import sqlite3
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.app import SignalGenApp
from app.auth.dependencies import get_current_user
from app.storage.sqlite_repo import SQLiteRepository


def _signal(user_id: str, symbol: str, minute: int = 0):
    return {
        "timestamp": f"2026-09-15T10:{minute:02d}:00",
        "symbol": symbol,
        "price": 1000.0 + minute,
        "rule_id": None,
        "user_id": user_id,
        "indicators": {"RSI14": 55.0},
    }


@pytest.fixture
def authorized_signal_app(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "authorized-signals.db"))
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
    ("method", "path"),
    [
        ("get", "/api/signals"),
        ("delete", "/api/signals"),
        ("delete", "/api/signals/1"),
    ],
)
def test_signal_endpoints_require_authentication(tmp_path, method, path):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized-signals.db"))

    with TestClient(signalgen.app) as client:
        response = client.request(method, path)

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_signal_history_and_delete_are_isolated_by_owner(
    authorized_signal_app,
):
    signalgen, client, identity = authorized_signal_app
    user_a_signal = signalgen.repository.save_signal(
        _signal("user-a", "BBCA", 1)
    )
    user_b_signal = signalgen.repository.save_signal(
        _signal("user-b", "TLKM", 2)
    )

    user_a_list = client.get("/api/signals")
    assert user_a_list.status_code == 200
    assert [signal["id"] for signal in user_a_list.json()] == [user_a_signal]
    assert user_a_list.json()[0]["user_id"] == "user-a"
    assert user_a_list.json()[0]["indicators"] == {"RSI14": 55.0}

    filtered = client.get("/api/signals", params={"symbol": "bbca"})
    assert [signal["id"] for signal in filtered.json()] == [user_a_signal]
    assert client.delete(f"/api/signals/{user_b_signal}").status_code == 404

    cleared = client.delete("/api/signals")
    assert cleared.status_code == 200
    assert cleared.json()["deleted"] == 1
    assert client.get("/api/signals").json() == []

    identity["id"] = "user-b"
    assert [signal["id"] for signal in client.get("/api/signals").json()] == [
        user_b_signal
    ]


def test_engine_and_api_share_the_same_repository(authorized_signal_app):
    signalgen, _, _ = authorized_signal_app
    assert signalgen.scalping_engine.repository is signalgen.repository


def test_repository_rejects_signal_without_owner(authorized_signal_app):
    signalgen, _, _ = authorized_signal_app
    unowned_signal = _signal("user-a", "BBCA")
    del unowned_signal["user_id"]

    with pytest.raises(ValueError, match="user_id is required"):
        signalgen.repository.save_signal(unowned_signal)


def test_engine_persists_generated_signal_for_its_owner(
    authorized_signal_app,
):
    signalgen, _, _ = authorized_signal_app
    engine = signalgen.scalping_engine
    engine.current_user_id = "user-a"
    engine.active_rule = {
        "id": signalgen.repository.get_system_rules()[0]["id"],
        "name": "Test rule",
        "definition": {"conditions": []},
    }

    engine._generate_signal(
        symbol="BBCA",
        price=1000.0,
        timestamp=time.time(),
        indicators={"PRICE": 1000.0},
    )

    signals = signalgen.repository.get_signals_for_user("user-a")
    assert len(signals) == 1
    assert signals[0]["symbol"] == "BBCA"
    assert signals[0]["user_id"] == "user-a"
    assert signalgen.repository.get_signals_for_user("user-b") == []


def test_legacy_signals_are_migrated_but_not_assigned_to_a_user(tmp_path):
    db_path = tmp_path / "legacy-signals.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute('''
            CREATE TABLE signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                time TEXT NOT NULL,
                symbol TEXT NOT NULL,
                price REAL NOT NULL,
                rule_id INTEGER,
                indicators TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute(
            "INSERT INTO signals (time, symbol, price) VALUES (?, ?, ?)",
            ("2026-01-01T00:00:00", "BBCA", 1000.0),
        )
        conn.commit()

    repository = SQLiteRepository(str(db_path))
    repository.initialize_database()

    with sqlite3.connect(db_path) as conn:
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(signals)")
        }

    assert "user_id" in columns
    assert repository.get_signals_for_user("user-a") == []
