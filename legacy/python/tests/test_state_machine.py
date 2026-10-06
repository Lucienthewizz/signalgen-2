"""Regression tests for thread-safe engine state inspection."""

import threading

from app.core.state_machine import StateMachine


def test_state_info_does_not_deadlock_on_nested_status_checks():
    state_machine = StateMachine()
    result = {}

    worker = threading.Thread(
        target=lambda: result.update(state_machine.get_state_info()),
        daemon=True,
    )
    worker.start()
    worker.join(timeout=1)

    assert worker.is_alive() is False
    assert result == {
        "state": "wait",
        "can_generate_signal": True,
        "remaining_cooldown": 0,
    }
