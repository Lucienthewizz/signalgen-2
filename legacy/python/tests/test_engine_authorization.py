"""Authorization tests for the single live-engine session."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.app import SignalGenApp
from app.auth.dependencies import get_current_user


RULE_DEFINITION = {
    "logic": "AND",
    "conditions": [{"left": "PRICE", "op": ">", "right": "EMA20"}],
}


class FakeThread:
    """Avoid starting the real market-data engine in API tests."""

    def __init__(self, *args, **kwargs):
        self.started = False

    def start(self):
        self.started = True


@pytest.fixture
def authorized_engine_app(tmp_path, monkeypatch):
    signalgen = SignalGenApp(str(tmp_path / "authorized-engine.db"))
    identity = {"id": "user-a"}

    def override_current_user():
        return SimpleNamespace(
            id=identity["id"],
            email=f"{identity['id']}@example.com",
            user_metadata={},
        )

    async def skip_broadcast_delay():
        return None

    monkeypatch.setattr(
        "app.services.engine_service.threading.Thread",
        FakeThread,
    )
    monkeypatch.setattr(
        signalgen.engine_service,
        "_broadcast_status_after_start",
        skip_broadcast_delay,
    )
    signalgen.app.dependency_overrides[get_current_user] = override_current_user

    with TestClient(signalgen.app) as client:
        yield signalgen, client, identity

    signalgen.app.dependency_overrides.clear()


def _create_engine_inputs(client):
    watchlist = client.post(
        "/api/watchlists",
        json={"name": "Engine watchlist", "symbols": ["BBCA"]},
    ).json()
    rule = client.post(
        "/api/rules",
        json={"name": "Engine rule", "definition": RULE_DEFINITION},
    ).json()
    return watchlist["id"], rule["id"]


@pytest.mark.parametrize(
    ("method", "path", "json_body"),
    [
        ("get", "/api/engine/status", None),
        ("get", "/api/status", None),
        (
            "post",
            "/api/engine/start",
            {"watchlist_id": 1, "rule_id": 1, "demo": True},
        ),
        ("post", "/api/engine/stop", None),
    ],
)
def test_engine_endpoints_require_authentication(
    tmp_path,
    method,
    path,
    json_body,
):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized-engine.db"))

    with TestClient(signalgen.app) as client:
        response = client.request(method, path, json=json_body)

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_engine_start_rejects_another_users_inputs(authorized_engine_app):
    signalgen, client, identity = authorized_engine_app
    watchlist_id, rule_id = _create_engine_inputs(client)

    identity["id"] = "user-b"
    response = client.post(
        "/api/engine/start",
        json={
            "watchlist_id": watchlist_id,
            "rule_id": rule_id,
            "demo": True,
        },
    )

    assert response.status_code == 404
    assert signalgen.engine_service.owner_user_id is None


def test_authenticated_user_can_read_detailed_system_status(
    authorized_engine_app,
):
    _, client, _ = authorized_engine_app

    response = client.get("/api/status")

    assert response.status_code == 200
    assert set(response.json()) == {
        "engine",
        "database",
        "websocket",
        "uptime",
        "version",
    }
    assert response.json()["version"] == "1.0.0"


def test_only_session_owner_can_view_or_stop_engine(authorized_engine_app):
    signalgen, client, identity = authorized_engine_app
    watchlist_id, rule_id = _create_engine_inputs(client)
    signalgen.scalping_engine.get_engine_status_sync = lambda: {
        "is_running": False,
        "is_connected": False,
        "state": {"state": "starting"},
        "active_watchlist": ["BBCA"],
        "active_rule": None,
        "ibkr_connected": False,
        "reconnect_attempts": 0,
        "connection_details": {},
    }

    started = client.post(
        "/api/engine/start",
        json={
            "watchlist_id": watchlist_id,
            "rule_id": rule_id,
            "demo": True,
        },
    )
    assert started.status_code == 200
    assert signalgen.engine_service.owner_user_id == "user-a"
    assert client.get("/api/engine/status").status_code == 200

    identity["id"] = "user-b"
    assert client.get("/api/engine/status").status_code == 403
    assert client.get("/api/status").status_code == 403
    assert client.post("/api/engine/stop").status_code == 403

    identity["id"] = "user-a"
    assert client.post("/api/engine/stop").status_code == 200
