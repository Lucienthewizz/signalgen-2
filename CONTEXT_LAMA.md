# Konteks Lama SignalGen

Dokumen ini menyimpan konteks teknis aplikasi SignalGen lama sebagai referensi
selama migrasi ke arsitektur SignalGen 2.0. Untuk keputusan yang masih berlaku,
gunakan `PROJECT_CONTEXT.md` dan `PRD.md` sebagai sumber utama.

## What this is

SignalGen is a desktop stock-signal application with a Python/FastAPI backend, SQLite storage, and an Electron frontend target. The legacy PyWebView entry point remains temporarily until Electron packaging replaces it. It has three operating modes sharing the same rule-evaluation core:

- **Scalping** (live): connects to Interactive Brokers TWS/Gateway via `ib_insync`, streams real-time bars, evaluates rules tick-by-tick.
- **Backtesting**: replays historical candles (IBKR or Yahoo) through the same `RuleEngine`/`IndicatorEngine` path as live trading, so backtest and live logic never diverge.
- **Swing screening**: on-demand batch screening of a ticker universe using cached Yahoo data, no live loop.

This repo is also a TA (Tugas Akhir / thesis) project — `docs/` contains dated sprint reports and `BAB_3`/`BAB_4` Indonesian thesis chapters. Treat those as historical/academic reference, not living documentation. `docs/` is gitignored (local-only, not version-controlled) since it's thesis material rather than part of the running system.

## Commands

```bash
# Run the headless backend (REST + Socket.IO)
docker compose up --build backend

# Run the backend test suite
docker compose run --rm backend-test

# Stop backend services
docker compose down
```

- The repository is split into `backend/` (Python/FastAPI) and `frontend/` (Electron/JavaScript workspace). Run backend commands from `backend/`.
- Coverage is gated **only** on `app/core/rule_engine.py` (`--cov=app/core/rule_engine --cov-fail-under=95`, set in `backend/pytest.ini`). Other modules are tested but not coverage-enforced.
- FastAPI serves on `http://127.0.0.1:3456` (REST + serves the UI + `/docs`), Socket.IO on `ws://127.0.0.1:8765`. Both are hardcoded defaults seeded into the `settings` table by `app/storage/init_db.py`.
- `backend/app/main.py`, `build_exe.py`, and the PyInstaller spec files are legacy fallback packaging. Preserve them until the Electron replacement can package and manage the Python backend.
- No formal DB migration framework: schema changes in `sqlite_repo.py`/`init_db.py` are raw `CREATE TABLE IF NOT EXISTS` + ad hoc `PRAGMA table_info` checks and `ALTER TABLE` for new columns.

## Architecture

### Signal pipeline (shared by all three modes)
`CandleBuilder` aggregates raw bars/ticks into OHLCV candles for a timeframe → on each **completed** candle, `IndicatorEngine` recomputes indicators and snapshots the previous values (enabling `_PREV` operands and `CROSS_UP`/`CROSS_DOWN`) → `RuleEngine.evaluate()` runs the rule's conditions against current indicator values → on a match, the engine persists the signal (`SQLiteRepository.save_signal`) and broadcasts it (`SocketIOBroadcaster.broadcast_signal`, which also fans out to Telegram).

- **`app/core/rule_engine.py`** — `RuleEngine`. Rule JSON: `{logic:"AND", conditions:[{left, op, right, ...}], cooldown_sec}` (only `AND` logic supported). Operators: `>`, `<`, `>=`, `<=`, `CROSS_UP`, `CROSS_DOWN`. Operands include fixed-period MAs/EMAs, MACD, RSI14, ADX5, Bollinger, Stochastic, Ichimoku, volume, TA-Lib candle patterns, plus **dynamic** operand templates (`MA{N}`, `EMA{N}`, `RSI{N}`, `ADX{N}`, `SMA_VOLUME_{N}`, period 1–250) and a generic `{OPERAND}_PREV_{N}` suffix for historical lookback. No `eval()`/dynamic code execution — rules are data, not code, by design. `estimate_rule_warmup` tells engines how many candles must accumulate before a rule can fire.
- **`app/core/indicator_engine.py`** — `IndicatorEngine`. Per-symbol candle history (deque, thread-safe via `RLock`); computes all indicators `RuleEngine` can reference. `set_required_operands(rule)` narrows computation to what a specific rule actually needs (including non-default dynamic periods).
- **`app/core/candle_builder.py`** — `CandleBuilder`. Supported timeframes: `1m, 5m, 15m, 1h, 4h, 1d`. Aligns incoming bars to timeframe buckets, dedupes by timestamp.
- **`app/core/state_machine.py`** — `StateMachine` (`WAIT → SIGNAL → COOLDOWN → WAIT`). Note: `ScalpingEngine` actually gates signal generation with its own per-symbol `symbol_cooldowns` dict, not this state machine — don't assume `StateMachine` is the source of truth for cooldown behavior.

### Engines (`app/engines/`)
- **`scalping_engine.py`** — `ScalpingEngine`. Owns an `ib_insync.IB` connection on a single asyncio event loop; `ib_insync` callbacks bridge back to that loop via `asyncio.run_coroutine_threadsafe`. Subscribes both `reqRealTimeBars` (5s bars, drives trading logic) and `reqMktData` (UI-only instant price) per symbol; warms up history via `reqHistoricalDataAsync` before going live. Reconnects with exponential backoff (capped, max 10 attempts); IBKR error 420 (real-time data not permitted) auto-falls-back to delayed market data.
- **`backtesting_engine.py`** — `BacktestingEngine`. Sequential (non-vectorized) candle replay through a fresh `IndicatorEngine`, same `RuleEngine.evaluate` path as live. No order execution — signal logging only.
- **`swing_screening_engine.py`** — `SwingScreeningEngine`. Concurrency-bounded (`asyncio.Semaphore`) batch screening with retry/backoff per ticker, using `CachedDataSource(YahooDataSource(), repo)`. Fetches extra warmup lookback via `RuleEngine.estimate_rule_warmup` before the evaluation window.

### Data sources (`app/data_sources/`)
`BaseDataSource` (ABC) defines the candle-fetching interface. `YahooDataSource` (via `yfinance`, intraday history windowed/chunked per Yahoo's retention limits) and `IBKRDataSource` (via `ib_insync`, separate IB connection from the scalping engine's) both implement it. `CachedDataSource` decorates either one: checks the `price_candles` table in `signalgen.db` for coverage, serves cache hits, fetches only the missing/incremental range otherwise, and tracks `is_final` per candle so only the still-open candle gets refreshed.

### Storage (`app/storage/sqlite_repo.py`, `init_db.py`)
`SQLiteRepository` owns all SQL. Tables: `rules`, `watchlists`, `watchlist_items`, `signals`, `settings`, `backtest_runs`, `backtest_signals`, `ticker_universes`, `price_candles` (the OHLCV cache used by `CachedDataSource`). Watchlists are single-active-at-a-time; system rules (`is_system=True`) can't be edited/deleted via the API. `init_db.py` seeds 4 default system rules, initial settings, a default watchlist, and default ticker universes idempotently on startup.

### WebSocket & notifications
`app/ws/broadcaster.py` (`SocketIOBroadcaster`) runs a Socket.IO `AsyncServer` with rooms `signals, engine_status, rules, watchlists, ibkr_status, errors, prices`. Since IB callbacks fire off the main event loop, most broadcast methods have `_sync` variants that bridge via `run_coroutine_threadsafe`. `app/notifications/telegram_notifier.py` reads Telegram config from the `settings` table and is invoked alongside every signal broadcast.

### Frontend (`frontend/`)
Frontend has exactly two application folders: `frontend/web/` for the landing/account/payment site and `frontend/desktop/` for Electron. The existing renderer lives in `frontend/desktop/renderer/` and is temporarily served by FastAPI. Key JS files are under `frontend/desktop/renderer/static/js/`.

## Constraints to preserve

- Rule definitions must stay pure data (no arbitrary code execution) — this is intentional, not a missing feature.
- Backtesting and swing screening must keep evaluating through the real `RuleEngine`/`IndicatorEngine`, not a reimplementation — that parity with live trading is load-bearing for the thesis's validity claims.
- Watchlist/rule mutation endpoints reject changes while the engine is running (`app/app.py` checks `_engine_running`) — don't bypass this when adding new mutating endpoints.
