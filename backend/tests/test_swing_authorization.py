from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.routes import swing as swing_routes
from app.app import SignalGenApp
from app.auth.dependencies import get_current_user


RULE_DEFINITION = {
    "logic": "AND",
    "conditions": [
        {"left": "PRICE", "op": ">", "right": "EMA20"},
    ],
}


@pytest.fixture
def authorized_app(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "authorized-swing.db"))
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


def _create_user_resources(signalgen, user_id="user-a"):
    rule_id = signalgen.repository.create_rule(
        name="Owned swing rule",
        rule_type="custom",
        definition=RULE_DEFINITION,
        user_id=user_id,
    )
    universe_id = signalgen.repository.create_ticker_universe(
        name="Owned IDX universe",
        tickers=["BBCA", "BBRI"],
        user_id=user_id,
    )
    return rule_id, universe_id


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (
            "/api/swing/screen",
            {"rule_id": 1, "ticker_universe_id": 1},
        ),
        (
            "/api/swing/backfill-yahoo-cache",
            {"ticker_universe_id": 1},
        ),
    ],
)
def test_swing_operations_require_authentication(tmp_path, path, body):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized-swing.db"))

    with TestClient(signalgen.app) as client:
        response = client.post(path, json=body)

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_other_users_resources_cannot_be_screened_or_backfilled(authorized_app):
    signalgen, client, identity = authorized_app
    rule_id, universe_id = _create_user_resources(signalgen)
    identity["id"] = "user-b"

    screen_response = client.post(
        "/api/swing/screen",
        json={"rule_id": rule_id, "ticker_universe_id": universe_id},
    )
    backfill_response = client.post(
        "/api/swing/backfill-yahoo-cache",
        json={"ticker_universe_id": universe_id},
    )

    assert screen_response.status_code == 404
    assert backfill_response.status_code == 404


def test_screening_receives_only_authorized_rule_and_universe(
    authorized_app,
    monkeypatch,
):
    signalgen, client, _ = authorized_app
    rule_id, universe_id = _create_user_resources(signalgen)
    captured = {}

    async def fake_screen_tickers(self, **kwargs):
        captured.update(kwargs)
        return [
            {
                "symbol": "BBCA",
                "signal": "BUY",
                "status": "success",
                "error_message": None,
            }
        ]

    monkeypatch.setattr(
        swing_routes.SwingScreeningEngine,
        "screen_tickers",
        fake_screen_tickers,
    )

    response = client.post(
        "/api/swing/screen",
        json={
            "rule_id": rule_id,
            "ticker_universe_id": universe_id,
            "timeframe": "1d",
            "lookback_days": 30,
        },
    )

    assert response.status_code == 200
    assert captured["tickers"] == ["BBCA", "BBRI"]
    assert captured["rule"]["id"] == rule_id
    assert captured["rule"]["user_id"] == "user-a"
    assert response.json()["summary"]["signals_found"] == 1


def test_backfill_receives_only_authorized_universe(
    authorized_app,
    monkeypatch,
):
    signalgen, client, _ = authorized_app
    _, universe_id = _create_user_resources(signalgen)
    captured = {}

    async def fake_backfill_symbols(self, **kwargs):
        captured.update(kwargs)
        return {"status": "completed"}

    monkeypatch.setattr(
        swing_routes.CachedDataSource,
        "backfill_symbols",
        fake_backfill_symbols,
    )

    response = client.post(
        "/api/swing/backfill-yahoo-cache",
        json={
            "ticker_universe_id": universe_id,
            "timeframes": ["1d", "4h", "1d"],
        },
    )

    assert response.status_code == 200
    assert captured["symbols"] == ["BBCA", "BBRI"]
    assert captured["timeframes"] == ["1d", "4h"]
    assert response.json()["universe_id"] == universe_id
