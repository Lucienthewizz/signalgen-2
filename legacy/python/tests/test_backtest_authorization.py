"""Authorization and migration tests for persisted backtest results."""

import sqlite3
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.app import SignalGenApp
from app.auth.dependencies import get_current_user
from app.storage.sqlite_repo import SQLiteRepository


@pytest.fixture
def authorized_backtest_app(tmp_path):
    signalgen = SignalGenApp(str(tmp_path / "authorized-backtests.db"))
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
        ("post", "/api/backtest/screen", {}),
        ("get", "/api/backtest/screen/runs", None),
        ("get", "/api/backtest/screen/runs/1", None),
        ("delete", "/api/backtest/screen/runs", None),
        ("delete", "/api/backtest/screen/runs/1", None),
        ("get", "/api/data/summary", None),
        ("post", "/api/backtest/export-csv", None),
        ("post", "/api/backtest/run", {}),
        ("get", "/api/backtest/runs", None),
        ("get", "/api/backtest/runs/1", None),
        ("delete", "/api/backtest/runs/1", None),
    ],
)
def test_backtest_data_endpoints_require_authentication(
    tmp_path, method, path, body
):
    signalgen = SignalGenApp(str(tmp_path / "unauthorized-backtests.db"))
    with TestClient(signalgen.app) as client:
        response = client.request(method, path, json=body)
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def _create_run(repository, user_id: str, name: str) -> int:
    return repository.create_backtest_run(
        user_id=user_id,
        name=name,
        mode="scalping",
        rule_id=1,
        symbols=["BBCA"],
        timeframe="1d",
        start_date=datetime(2026, 1, 1),
        end_date=datetime(2026, 2, 1),
        data_source="yahoo",
    )


def _create_screen_run(repository, user_id: str, mode: str) -> int:
    return repository.create_backtest_screen_run(
        user_id=user_id,
        mode=mode,
        timeframe="1d",
        exit_strategy="holding_period",
        row_count=1,
        config={"mode": mode},
        summary={"total_entries": 1},
    )


def test_classic_backtest_history_is_isolated_by_owner(
    authorized_backtest_app,
):
    signalgen, client, identity = authorized_backtest_app
    user_a_run = _create_run(signalgen.repository, "user-a", "A run")
    user_b_run = _create_run(signalgen.repository, "user-b", "B run")

    signalgen.repository.create_backtest_signals(
        user_a_run,
        [{
            "symbol": "BBCA",
            "timestamp": datetime(2026, 1, 10),
            "signal_type": "BUY",
            "price": 9000,
            "indicators": {"RSI14": 55},
        }],
    )

    listed = client.get("/api/backtest/runs").json()["runs"]
    assert [run["id"] for run in listed] == [user_a_run]
    own_run = client.get(f"/api/backtest/runs/{user_a_run}")
    assert own_run.status_code == 200
    assert len(own_run.json()["signals"]) == 1
    assert client.get(f"/api/backtest/runs/{user_b_run}").status_code == 404
    assert client.delete(f"/api/backtest/runs/{user_b_run}").status_code == 404

    identity["id"] = "user-b"
    assert [run["id"] for run in client.get("/api/backtest/runs").json()["runs"]] == [
        user_b_run
    ]


def test_screen_backtest_history_and_clear_are_isolated_by_owner(
    authorized_backtest_app,
):
    signalgen, client, identity = authorized_backtest_app
    user_a_run = _create_screen_run(signalgen.repository, "user-a", "manual")
    user_b_run = _create_screen_run(signalgen.repository, "user-b", "rule")

    listed = client.get("/api/backtest/screen/runs").json()
    assert [run["id"] for run in listed] == [user_a_run]
    assert client.get(f"/api/backtest/screen/runs/{user_b_run}").status_code == 404
    assert client.delete(f"/api/backtest/screen/runs/{user_b_run}").status_code == 404

    cleared = client.delete("/api/backtest/screen/runs")
    assert cleared.status_code == 200
    assert cleared.json()["deleted"] == 1

    identity["id"] = "user-b"
    assert [run["id"] for run in client.get("/api/backtest/screen/runs").json()] == [
        user_b_run
    ]


def test_run_rejects_another_users_custom_rule_before_market_data(
    authorized_backtest_app,
):
    signalgen, client, identity = authorized_backtest_app
    foreign_rule = signalgen.repository.create_rule(
        name="Private rule",
        rule_type="custom",
        definition={"logic": "AND", "conditions": []},
        user_id="user-b",
    )

    response = client.post(
        "/api/backtest/run",
        json={
            "name": "Forbidden",
            "mode": "scalping",
            "rule_id": foreign_rule,
            "symbols": ["BBCA"],
            "timeframe": "1d",
            "start_date": "2026-01-01T00:00:00",
            "end_date": "2026-02-01T00:00:00",
            "data_source": "yahoo",
        },
    )

    assert identity["id"] == "user-a"
    assert response.status_code == 404
    assert response.json() == {"detail": "Backtest rule not found"}


def test_screen_endpoint_persists_run_for_current_user(
    authorized_backtest_app,
    monkeypatch,
):
    signalgen, client, _ = authorized_backtest_app

    async def fake_fetch(*args, **kwargs):
        return [
            {
                "timestamp": datetime(2026, 1, 1),
                "open": 100.0,
                "high": 102.0,
                "low": 99.0,
                "close": 101.0,
                "volume": 1000,
            },
            {
                "timestamp": datetime(2026, 1, 2),
                "open": 101.0,
                "high": 105.0,
                "low": 100.0,
                "close": 104.0,
                "volume": 1100,
            },
        ]

    monkeypatch.setattr(
        "app.data_sources.cached_data_source.CachedDataSource.fetch_historical_data",
        fake_fetch,
    )
    response = client.post(
        "/api/backtest/screen",
        json={
            "mode": "manual",
            "timeframe": "1d",
            "n_steps": 1,
            "data_source": "yahoo",
            "manual_entries": [
                {
                    "symbol": "BBCA",
                    "entry_time": "2026-01-01T00:00:00",
                    "signal_type": "BUY",
                    "entry_price": 100.0,
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["row_count"] == 1
    runs = signalgen.repository.get_backtest_screen_runs("user-a")
    assert len(runs) == 1
    assert runs[0]["user_id"] == "user-a"


def test_legacy_backtests_gain_owner_column_but_stay_hidden(tmp_path):
    db_path = tmp_path / "legacy-backtests.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute('''
            CREATE TABLE backtest_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                mode TEXT NOT NULL,
                rule_id INTEGER NOT NULL,
                symbols TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                data_source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                total_signals INTEGER DEFAULT 0,
                metadata TEXT
            )
        ''')
        connection.execute('''
            CREATE TABLE backtest_screen_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                mode TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                exit_strategy TEXT NOT NULL,
                row_count INTEGER DEFAULT 0,
                config TEXT NOT NULL,
                summary TEXT
            )
        ''')
        connection.execute(
            "INSERT INTO backtest_runs "
            "(name, mode, rule_id, symbols, timeframe, start_date, end_date, data_source, created_at) "
            "VALUES ('legacy', 'scalping', 1, '[\"BBCA\"]', '1d', '2026-01-01', '2026-02-01', 'yahoo', '2026-02-01')"
        )
        connection.execute(
            "INSERT INTO backtest_screen_runs "
            "(created_at, mode, timeframe, exit_strategy, config) "
            "VALUES ('2026-02-01', 'manual', '1d', 'holding_period', '{}')"
        )
        connection.commit()

    repository = SQLiteRepository(str(db_path))
    repository.initialize_database()

    with sqlite3.connect(db_path) as connection:
        classic_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(backtest_runs)")
        }
        screen_columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(backtest_screen_runs)")
        }

    assert "user_id" in classic_columns
    assert "user_id" in screen_columns
    assert repository.get_all_backtest_runs("user-a") == []
    assert repository.get_backtest_screen_runs("user-a") == []
