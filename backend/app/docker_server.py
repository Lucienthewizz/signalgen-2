"""Headless Docker entry point for the SignalGen backend services."""

import asyncio
import logging
import os
import threading

import uvicorn

from .app import signalgen_app


logger = logging.getLogger(__name__)


def _run_socketio(host: str, port: int) -> None:
    """Initialize and serve the Socket.IO application in a daemon thread."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(signalgen_app.broadcaster.initialize())

    uvicorn.run(
        signalgen_app.broadcaster.create_asgi_app(),
        host=host,
        port=port,
        log_level="info",
        access_log=False,
    )


def main() -> None:
    """Run REST and Socket.IO without starting the legacy desktop window."""
    host = os.getenv("SIGNALGEN_HOST", "0.0.0.0")
    api_port = int(os.getenv("SIGNALGEN_API_PORT", "3456"))
    socket_port = int(os.getenv("SIGNALGEN_SOCKET_PORT", "8765"))

    socket_thread = threading.Thread(
        target=_run_socketio,
        args=(host, socket_port),
        name="signalgen-socketio",
        daemon=True,
    )
    socket_thread.start()
    logger.info("Socket.IO server starting on %s:%s", host, socket_port)

    uvicorn.run(
        signalgen_app.app,
        host=host,
        port=api_port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
