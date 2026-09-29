import sqlite3
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.app import SignalGenApp
from app.auth.dependencies import get_current_user
from app.storage.sqlite_repo import SQLiteRepository


@pytest.fixture
def authorized_app(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "authorized-watchlists.db"))
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


def test_watchlists_require_authentication(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized-watchlists.db"))

    with TestClient(signalgen.app) as client:
        response = client.get("/api/watchlists")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_watchlist_crud_is_isolated_by_owner(authorized_app):
    _, client, identity = authorized_app

    create_response = client.post(
        "/api/watchlists",
        json={"name": "IDX Banks", "symbols": ["bbca", "bbri"]},
    )
    assert create_response.status_code == 201
    created = create_response.json()
    watchlist_id = created["id"]
    assert created["user_id"] == "user-a"
    assert created["symbols"] == ["BBCA", "BBRI"]

    update_response = client.put(
        f"/api/watchlists/{watchlist_id}",
        json={"symbols": ["bmri", "bni"]},
    )
    assert update_response.status_code == 200
    assert update_response.json()["symbols"] == ["BMRI", "BNI"]

    user_a_list = client.get("/api/watchlists")
    assert user_a_list.status_code == 200
    assert watchlist_id in {
        watchlist["id"] for watchlist in user_a_list.json()
    }

    identity["id"] = "user-b"
    user_b_list = client.get("/api/watchlists")
    assert user_b_list.status_code == 200
    assert watchlist_id not in {
        watchlist["id"] for watchlist in user_b_list.json()
    }

    assert client.get(f"/api/watchlists/{watchlist_id}").status_code == 404
    assert client.put(
        f"/api/watchlists/{watchlist_id}",
        json={"name": "Hijacked watchlist"},
    ).status_code == 404
    assert client.put(
        f"/api/watchlists/{watchlist_id}/activate"
    ).status_code == 404
    assert client.delete(f"/api/watchlists/{watchlist_id}").status_code == 404

    identity["id"] = "user-a"
    assert client.put(
        f"/api/watchlists/{watchlist_id}/activate"
    ).status_code == 200
    assert client.delete(f"/api/watchlists/{watchlist_id}").status_code == 200
    assert client.get(f"/api/watchlists/{watchlist_id}").status_code == 404


def test_active_watchlist_is_independent_for_each_user(authorized_app):
    signalgen, client, identity = authorized_app

    user_a_watchlist = client.post(
        "/api/watchlists",
        json={"name": "User A", "symbols": ["BBCA"]},
    ).json()
    assert client.put(
        f"/api/watchlists/{user_a_watchlist['id']}/activate"
    ).status_code == 200

    identity["id"] = "user-b"
    user_b_watchlist = client.post(
        "/api/watchlists",
        json={"name": "User B", "symbols": ["TLKM"]},
    ).json()
    assert client.put(
        f"/api/watchlists/{user_b_watchlist['id']}/activate"
    ).status_code == 200

    active_a = signalgen.repository.get_active_watchlist_for_user("user-a")
    active_b = signalgen.repository.get_active_watchlist_for_user("user-b")
    assert active_a["id"] == user_a_watchlist["id"]
    assert active_b["id"] == user_b_watchlist["id"]


def test_legacy_watchlist_schema_migrates_without_exposing_unowned_rows(tmp_path):
    db_path = tmp_path / "legacy-watchlists.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute('''
            CREATE TABLE watchlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                is_active BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute(
            "INSERT INTO watchlists (name, is_active) VALUES (?, TRUE)",
            ("Legacy watchlist",),
        )
        conn.commit()

    repository = SQLiteRepository(str(db_path))
    repository.initialize_database()

    with sqlite3.connect(db_path) as conn:
        columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(watchlists)")
        }

    assert "user_id" in columns
    assert repository.get_watchlists_for_user("user-a") == []
