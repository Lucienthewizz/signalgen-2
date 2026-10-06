import json
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.app import SignalGenApp
from app.auth.dependencies import get_current_user
from app.storage.sqlite_repo import SQLiteRepository


RULE_DEFINITION = {
    "logic": "AND",
    "conditions": [
        {"left": "PRICE", "op": ">", "right": "EMA20"},
    ],
}


@pytest.fixture
def authorized_app(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "authorized.db"))
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


def test_rules_require_authentication(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized.db"))

    with TestClient(signalgen.app) as client:
        response = client.get("/api/rules")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_custom_rule_crud_is_isolated_by_owner(authorized_app):
    _, client, identity = authorized_app

    create_response = client.post(
        "/api/rules",
        json={"name": "User A rule", "definition": RULE_DEFINITION},
    )
    assert create_response.status_code == 201
    created_rule = create_response.json()
    rule_id = created_rule["id"]
    assert created_rule["user_id"] == "user-a"

    user_a_list = client.get("/api/rules")
    assert user_a_list.status_code == 200
    assert rule_id in {rule["id"] for rule in user_a_list.json()}

    identity["id"] = "user-b"
    user_b_list = client.get("/api/rules")
    assert user_b_list.status_code == 200
    assert rule_id not in {rule["id"] for rule in user_b_list.json()}

    assert client.get(f"/api/rules/{rule_id}").status_code == 404
    assert client.put(
        f"/api/rules/{rule_id}",
        json={"name": "Hijacked rule"},
    ).status_code == 404
    assert client.put(f"/api/rules/{rule_id}/activate").status_code == 404
    assert client.delete(f"/api/rules/{rule_id}").status_code == 404

    identity["id"] = "user-a"
    update_response = client.put(
        f"/api/rules/{rule_id}",
        json={"name": "Updated User A rule"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Updated User A rule"
    assert client.put(f"/api/rules/{rule_id}/activate").status_code == 200
    assert client.delete(f"/api/rules/{rule_id}").status_code == 200
    assert client.get(f"/api/rules/{rule_id}").status_code == 404


def test_system_rules_are_shared_but_cannot_be_modified(authorized_app):
    signalgen, client, identity = authorized_app
    system_rule = signalgen.repository.get_system_rules()[0]

    assert client.get(f"/api/rules/{system_rule['id']}").status_code == 200
    identity["id"] = "user-b"
    assert client.get(f"/api/rules/{system_rule['id']}").status_code == 200
    assert client.put(
        f"/api/rules/{system_rule['id']}",
        json={"name": "Modified system rule"},
    ).status_code == 404
    assert client.delete(f"/api/rules/{system_rule['id']}").status_code == 404


def test_legacy_rule_schema_migrates_without_exposing_unowned_custom_rules(tmp_path):
    db_path = tmp_path / "legacy.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute('''
            CREATE TABLE rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                definition TEXT NOT NULL,
                is_system BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
            INSERT INTO rules (name, type, definition, is_system)
            VALUES (?, ?, ?, FALSE)
        ''', ("Legacy custom rule", "custom", json.dumps(RULE_DEFINITION)))
        conn.commit()

    repository = SQLiteRepository(str(db_path))
    repository.initialize_database()

    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(rules)")}

    assert "user_id" in columns
    assert repository.get_rules_for_user("user-a") == []
