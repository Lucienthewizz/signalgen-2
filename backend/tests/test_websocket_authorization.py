"""Authentication and private-room tests for Socket.IO realtime events."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.ws.broadcaster import SocketIOBroadcaster


def _broadcaster(authenticator=None):
    broadcaster = SocketIOBroadcaster(
        token_authenticator=(
            authenticator
            or (lambda token: SimpleNamespace(id=f"user-{token}"))
        )
    )
    broadcaster.sio.enter_room = AsyncMock()
    broadcaster.sio.leave_room = AsyncMock()
    broadcaster.sio.emit = AsyncMock()
    return broadcaster


def test_socket_connection_requires_a_valid_access_token():
    broadcaster = _broadcaster()
    connect = broadcaster.sio.handlers['/']['connect']

    assert asyncio.run(connect("missing", {}, None)) is False
    assert "missing" not in broadcaster.connected_clients

    def reject_token(token):
        raise ValueError("invalid token")

    rejected = _broadcaster(reject_token)
    rejected_connect = rejected.sio.handlers['/']['connect']
    assert asyncio.run(
        rejected_connect("invalid", {}, {"token": "bad"})
    ) is False
    assert "invalid" not in rejected.connected_clients


def test_authenticated_socket_joins_only_private_user_rooms():
    broadcaster = _broadcaster()
    connect = broadcaster.sio.handlers['/']['connect']

    accepted = asyncio.run(
        connect(
            "sid-a",
            {"REMOTE_ADDR": "127.0.0.1"},
            {"token": "a"},
        )
    )

    assert accepted is True
    client = broadcaster.connected_clients["sid-a"]
    assert client["user_id"] == "user-a"
    assert set(client["rooms"]) == {
        "signals:user:user-a",
        "engine_status:user:user-a",
    }
    entered_rooms = {
        call.args[1] for call in broadcaster.sio.enter_room.await_args_list
    }
    assert entered_rooms == set(client["rooms"])


def test_room_subscription_is_scoped_to_authenticated_user():
    broadcaster = _broadcaster()
    connect = broadcaster.sio.handlers['/']['connect']
    join_room = broadcaster.sio.handlers['/']['join_room']
    asyncio.run(connect("sid-a", {}, {"token": "a"}))
    broadcaster.sio.enter_room.reset_mock()

    asyncio.run(join_room("sid-a", {"room": "prices"}))

    broadcaster.sio.enter_room.assert_awaited_once_with(
        "sid-a",
        "prices:user:user-a",
    )

    broadcaster.sio.enter_room.reset_mock()
    asyncio.run(join_room("sid-a", {"room": "app_logs"}))
    broadcaster.sio.enter_room.assert_awaited_once_with(
        "sid-a",
        "app_logs:user:user-a",
    )


def test_realtime_signal_is_emitted_only_to_its_owner_room():
    broadcaster = _broadcaster()
    signal = {
        "symbol": "BBCA",
        "price": 1000.0,
        "rule_id": 1,
        "user_id": "user-a",
        "timestamp": "2026-09-15T10:00:00",
    }

    asyncio.run(broadcaster.broadcast_signal(signal))

    broadcaster.sio.emit.assert_awaited_once()
    emit_call = broadcaster.sio.emit.await_args
    assert emit_call.args[0] == "signal"
    assert emit_call.kwargs["room"] == "signals:user:user-a"
    assert "user_id" not in emit_call.args[1]


def test_realtime_log_is_emitted_only_to_its_owner_room():
    broadcaster = _broadcaster()
    broadcaster.connected_clients["sid-a"] = {"user_id": "user-a"}

    asyncio.run(broadcaster.broadcast_log_entry("private log", "user-a"))

    broadcaster.sio.emit.assert_awaited_once_with(
        "log_entry",
        {"line": "private log"},
        room="app_logs:user:user-a",
    )


def test_engine_realtime_events_use_active_owner_room():
    broadcaster = _broadcaster()
    broadcaster.active_user_id = "user-a"
    broadcaster.connected_clients["sid-a"] = {"user_id": "user-a"}

    asyncio.run(broadcaster.broadcast_price_update("BBCA", 1000.0, 0))
    price_call = broadcaster.sio.emit.await_args
    assert price_call.kwargs["room"] == "prices:user:user-a"

    broadcaster.sio.emit.reset_mock()
    asyncio.run(
        broadcaster.broadcast_engine_status(
            {"state": {"state": "running"}}
        )
    )
    status_call = broadcaster.sio.emit.await_args
    assert status_call.kwargs["room"] == "engine_status:user:user-a"
