import json
import sqlite3
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.app import SignalGenApp
from app.auth.dependencies import get_current_user
from app.storage.sqlite_repo import SQLiteRepository


@pytest.fixture
def authorized_app(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "authorized-universes.db"))
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


def test_universes_require_authentication(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized-universes.db"))

    with TestClient(signalgen.app) as client:
        response = client.get("/api/swing/universes")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_personal_universe_crud_is_isolated_by_owner(authorized_app):
    _, client, identity = authorized_app

    create_response = client.post(
        "/api/swing/universes",
        json={
            "name": "IDX Banks",
            "tickers": ["bbca", "bbri"],
            "description": "Indonesian banks",
        },
    )
    assert create_response.status_code == 200
    universe_id = create_response.json()["universe_id"]

    detail_response = client.get(f"/api/swing/universes/{universe_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["user_id"] == "user-a"
    assert detail_response.json()["tickers"] == ["BBCA", "BBRI"]

    identity["id"] = "user-b"
    user_b_list = client.get("/api/swing/universes")
    assert user_b_list.status_code == 200
    assert universe_id not in {
        universe["id"] for universe in user_b_list.json()["universes"]
    }
    assert client.get(f"/api/swing/universes/{universe_id}").status_code == 404
    assert client.put(
        f"/api/swing/universes/{universe_id}",
        json={"name": "Hijacked universe"},
    ).status_code == 404
    assert client.delete(f"/api/swing/universes/{universe_id}").status_code == 404

    # Names are unique per owner, not globally across every account.
    user_b_create = client.post(
        "/api/swing/universes",
        json={"name": "IDX Banks", "tickers": ["BMRI"]},
    )
    assert user_b_create.status_code == 200

    identity["id"] = "user-a"
    update_response = client.put(
        f"/api/swing/universes/{universe_id}",
        json={"tickers": ["bbni", "bmri"]},
    )
    assert update_response.status_code == 200
    assert client.get(
        f"/api/swing/universes/{universe_id}"
    ).json()["tickers"] == ["BBNI", "BMRI"]
    assert client.delete(f"/api/swing/universes/{universe_id}").status_code == 200


def test_system_universes_are_shared_but_cannot_be_modified(authorized_app):
    _, client, identity = authorized_app

    user_a_universes = client.get("/api/swing/universes").json()["universes"]
    system_universe = next(
        universe for universe in user_a_universes if universe["is_system"]
    )

    identity["id"] = "user-b"
    assert client.get(
        f"/api/swing/universes/{system_universe['id']}"
    ).status_code == 200
    assert client.put(
        f"/api/swing/universes/{system_universe['id']}",
        json={"name": "Changed system universe"},
    ).status_code == 404
    assert client.delete(
        f"/api/swing/universes/{system_universe['id']}"
    ).status_code == 404


def test_legacy_universe_schema_preserves_system_rows_and_hides_custom_rows(
    tmp_path,
):
    db_path = tmp_path / "legacy-universes.db"
    now = datetime.now().isoformat()
    with sqlite3.connect(db_path) as conn:
        conn.execute('''
            CREATE TABLE ticker_universes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                tickers TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')
        conn.execute('''
            INSERT INTO ticker_universes (
                name, tickers, description, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
        ''', (
            "Tech Giants",
            json.dumps(["AAPL"]),
            "Major technology stocks",
            now,
            now,
        ))
        conn.execute('''
            INSERT INTO ticker_universes (
                name, tickers, description, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
        ''', (
            "Legacy custom",
            json.dumps(["BBCA"]),
            "Old private data",
            now,
            now,
        ))
        conn.commit()

    repository = SQLiteRepository(str(db_path))
    repository.initialize_database()

    visible = repository.get_ticker_universes_for_user("user-a")
    assert [universe["name"] for universe in visible] == ["Tech Giants"]
    assert visible[0]["is_system"]
    assert repository.get_ticker_universe_for_user(2, "user-a") is None

    first_id = repository.create_ticker_universe(
        name="Same name",
        tickers=["BBCA"],
        user_id="user-a",
    )
    second_id = repository.create_ticker_universe(
        name="Same name",
        tickers=["TLKM"],
        user_id="user-b",
    )
    assert first_id != second_id
