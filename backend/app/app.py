"""
FastAPI Application Module

This module provides the main FastAPI application for the SignalGen scalping system.
It handles REST API endpoints and integrates with the Socket.IO broadcaster.

Key Features:
- REST API for rule management
- REST API for watchlist management
- REST API for engine control
- Integration with Socket.IO for real-time updates
- CORS support for PyWebView frontend
- Automatic API documentation

API Endpoints:
- /api/rules/: CRUD operations for trading rules
- /api/watchlists/: CRUD operations for watchlists
- /api/engine/: Engine control and status
- /api/signals/: Signal history and retrieval
- /api/settings/: Application settings

Typical Usage:
    app = SignalGenApp()
    app.initialize_database()
    app.start_server()
    # API runs on http://localhost:3456
"""

import logging
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path

from .storage.sqlite_repo import SQLiteRepository
from .logging_utils import log_handler
from .ws.broadcaster import SocketIOBroadcaster
from .engines.scalping_engine import ScalpingEngine
from .core.rule_engine import RuleEngine
from .api.routes.auth import router as auth_router
from .api.routes.backtests import create_backtests_router
from .api.routes.engine import create_engine_router
from .api.routes.logs import create_logs_router
from .api.routes.rules import create_rules_router
from .api.routes.signals import create_signals_router
from .api.routes.settings import create_settings_router
from .api.routes.swing import create_swing_router
from .api.routes.system import create_system_router
from .api.routes.telegram import create_telegram_router
from .api.routes.universes import create_universes_router
from .api.routes.watchlists import create_watchlists_router
from .services.rule_service import RuleService
from .services.backtest_service import BacktestService
from .services.engine_service import EngineService
from .services.log_service import LogService
from .services.signal_service import SignalService
from .services.settings_service import SettingsService
from .services.swing_chart_service import SwingChartService
from .services.system_service import SystemService
from .services.telegram_service import TelegramService
from .services.universe_service import UniverseService
from .services.watchlist_service import WatchlistService

class SignalGenApp:
    """
    Main FastAPI application for SignalGen system.
    
    This class provides REST API endpoints for all system operations
    and integrates with the WebSocket broadcaster for real-time updates.
    """
    
    def __init__(self, db_path: str = 'signalgen.db'):
        """
        Initialize the FastAPI application.
        
        Args:
            db_path: Path to SQLite database
        """
        # Resolve the frontend independently from the Python backend package.
        import sys
        if getattr(sys, 'frozen', False):
            # Running in PyInstaller bundle
            base_dir = Path(sys._MEIPASS)
            ui_dir = base_dir / "frontend" / "desktop" / "renderer"
        else:
            # backend/app/app.py -> repository root -> desktop renderer
            repository_root = Path(__file__).resolve().parents[2]
            ui_dir = repository_root / "frontend" / "desktop" / "renderer"

        static_dir = ui_dir / "static"
        templates_dir = ui_dir
        
        self.app = FastAPI(
            title="SignalGen API",
            description="Real-time scalping signal generator API",
            version="1.0.0",
            docs_url="/docs",
            redoc_url="/redoc"
        )
        
        # Mount static files
        if static_dir.exists():
            self.app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
        
        # Setup templates
        self.templates = Jinja2Templates(directory=str(templates_dir)) if templates_dir.exists() else None
        
        self.repository = SQLiteRepository(db_path)
        self.rule_engine = RuleEngine()
        
        # Initialize database schema and default data
        # Must be done before accessing settings or creating engine
        self.repository.initialize_database()
        from .storage.init_db import initialize_database as init_db
        init_db(db_path)
        
        # Initialize broadcaster with repository for Telegram integration
        self.broadcaster = SocketIOBroadcaster(repository=self.repository)
        
        # Get timeframe from settings, default to '1m'
        timeframe = self.repository.get_setting('timeframe') or '1m'
        self.scalping_engine = ScalpingEngine(timeframe=timeframe)
        self.scalping_engine.repository = self.repository
        
        self.logger = logging.getLogger(__name__)
        
        self.rule_service = RuleService(self.repository, self.rule_engine)
        self.backtest_service = BacktestService(self.repository)
        self.signal_service = SignalService(self.repository)
        self.log_service = LogService(log_handler)
        self.settings_service = SettingsService(
            self.repository,
            self.scalping_engine,
        )
        self.swing_chart_service = SwingChartService(
            self.repository,
            self.rule_service,
        )
        self.telegram_service = TelegramService(self.repository)
        self.universe_service = UniverseService(self.repository)
        self.watchlist_service = WatchlistService(self.repository)
        self.engine_service = EngineService(
            scalping_engine=self.scalping_engine,
            broadcaster=self.broadcaster,
            rule_service=self.rule_service,
            watchlist_service=self.watchlist_service,
            logger=self.logger,
            settings_service=self.settings_service,
        )
        self.system_service = SystemService(
            repository=self.repository,
            broadcaster=self.broadcaster,
            engine_service=self.engine_service,
        )
        
        # Set broadcaster reference in scalping engine
        self.scalping_engine.broadcaster = self.broadcaster
        
        # Configure CORS with specific origins for security
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:3456", "http://127.0.0.1:3456", "file://"],
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["*"],
        )
        
        # Register feature routers; only the transitional UI route remains local.
        self.app.include_router(auth_router)
        self.app.include_router(create_backtests_router(self.backtest_service))
        self.app.include_router(
            create_rules_router(
                self.rule_service,
                engine_is_running=lambda: self.engine_service.is_busy,
            )
        )
        self.app.include_router(
            create_watchlists_router(
                self.watchlist_service,
                engine_is_running=lambda: self.engine_service.is_busy,
            )
        )
        self.app.include_router(create_engine_router(self.engine_service))
        self.app.include_router(create_system_router(self.system_service))
        self.app.include_router(create_logs_router(self.log_service))
        self.app.include_router(create_signals_router(self.signal_service))
        self.app.include_router(
            create_settings_router(self.settings_service, self.broadcaster)
        )
        self.app.include_router(create_telegram_router(self.telegram_service))
        self.app.include_router(
            create_universes_router(self.universe_service)
        )
        self.app.include_router(
            create_swing_router(
                repository=self.repository,
                rule_service=self.rule_service,
                universe_service=self.universe_service,
                chart_service=self.swing_chart_service,
            )
        )
        self._register_routes()
        
        # Log startup
        self.logger.info("SignalGen application initialized")

    def _register_routes(self) -> None:
        """Register all API routes."""
        
        @self.app.get("/", response_class=HTMLResponse)
        async def serve_ui(request: Request):
            """Serve the main UI dashboard."""
            if self.templates:
                return self.templates.TemplateResponse(
                    request=request,
                    name="index.html",
                    context={}
                )
            else:
                # Fallback if templates directory doesn't exist
                return HTMLResponse("""
                <html>
                    <head><title>SignalGen</title></head>
                    <body>
                        <h1>SignalGen UI</h1>
                        <p>Templates directory not found. Please check your installation.</p>
                        <p><a href="/docs">API Documentation</a></p>
                    </body>
                </html>
                """)
        
    def initialize_database(self) -> None:
        """
        Initialize the database.
        
        Note: Database is already initialized during __init__.
        This method is kept for backward compatibility.
        """
        self.logger.info("Database already initialized during app startup")
    
    def get_app(self) -> FastAPI:
        """
        Get the FastAPI application instance.
        
        Returns:
            FastAPI: The configured FastAPI app
        """
        return self.app
    
    def get_socketio_app(self):
        """
        Get the Socket.IO ASGI application for WebSocket support.
        
        Returns:
            ASGI app: The Socket.IO ASGI application
        """
        return self.broadcaster.create_asgi_app()

# Create global app instance
signalgen_app = SignalGenApp(
    db_path=os.getenv("SIGNALGEN_DB_PATH", "signalgen.db")
)
app = signalgen_app.get_app()
