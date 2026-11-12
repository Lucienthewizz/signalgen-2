# Market and historical screening

The screener has a separate market/historical mode for matching stocks and
signal dates across the current IDX or US catalog, or an owned universe. Ten
stocks is the internal batch size, not the total search limit. Membership is
frozen at scan creation, not reconstructed as a point-in-time historical catalog.

## Contract

- `POST /api/v1/screener/scans` freezes source, rule hash and inclusive daily
  search dates, at most one year.
- `POST /api/v1/screener/scans/{id}/batches/{batch}/prepare` prepares a batch and
  reports missing data per stock.
- `DELETE /api/v1/screener/scans/{id}/batches/{batch}/prepare` releases snapshots.
- `DELETE /api/v1/screener/scans/{id}` cancels/releases a scan.
- `POST /api/v1/screener/signals` evaluates one complete symbol feature history.

These routes require screener access, account/session ownership and applicable
rule/timeframe tier checks. Snapshots and grants use purpose `screen`. Backtest
routes still require backtest access and reject screen grants. Each API process
allows 32 active scans, one per account/session, with a two-hour TTL.

Snapshots include indicator warmup and stop at the inclusive search window's
exclusive next-day boundary. No future outcome candles are fetched. The internal
`n_steps: 1` field preserves snapshot compatibility; TP/SL settings are rejected.
Browser Worker/WASM computes indicators; private rule scoring stays on the server.
Screening stores stock/date/direction observations with empty outcome lists and
does not invoke financial study computation. Results are paginated and incomplete
coverage remains visible. Stop or leaving the mode cancels browser work.

Open backtest evaluation transfers the frozen source, rule and dates into an
independently authorized form. Backtest prepares a new snapshot and requires
evaluation settings; it does not reuse the screening grant or promise the exact
old market snapshot.

## Verification and remaining phases

New regression cases cover 23 stocks in three frozen batches, screener-only
access, rejection by the backtest endpoint, session/rule changes, and no future
outcome candles. The client fixture checks that all 23 symbols are processed
without invoking outcome computation.

Verification on 12 November 2026:

- Frontend TypeScript check and production build passed.
- All 255 frontend unit tests passed, including signal-only orchestration.
- `npm run test:market-screen` passed with a fresh headless Chrome profile,
  real Go/WASM and IndexedDB, and synthetic account/API/provider decisions.
  It covers 23 stocks in three batches, pagination, partial failures, restarting,
  Stop during preparation, an owned-universe selection, no matches, denied
  access, keyboard order, and 1440/390px dark/light layouts.
- Screenshot inspection found a squeezed heading and unstyled table. Reusing
  the existing study header composition and table/field classes fixed them;
  the browser suite and production build passed again afterward.
- `TestMarketScreeningFrozenCatalogWithoutBacktestAccess` and
  `TestScreeningSnapshotStopsAtSignalWindow` passed in a read-only Linux
  container with no external network, scratch-only writes, and bounded CPU,
  memory, processes, file size, disk and wall time. It used existing local Go
  dependencies and dummy principals/data.

Browser evidence is in `docs/evidence/market-screen-browser-20261112.json`.
Generated screenshots are under `frontend/web/output/playwright/market-screen-*`.
The focused browser fixture can be rerun with the frontend dev server on port
5174, or `SIGNALGEN_TEST_BASE_URL` pointing at its local URL.

The broader workspace browser suite passed on 12 November 2026 after integrating
the existing EMA 9 regression-test fix onto backend/data commit `3ee6f3a`.
The market-screen suite also passed with rebuilt real Go/WASM and synthetic API
fixtures. See [integration verification](../frontend/BROWSER_REGRESSION_INTEGRATION.md)
for commands and the unresolved repository format check. Live Yahoo coverage and
production capacity remain unverified.

Performance optimization, scheduled incremental collection, evaluation-choice
refinements and premium-provider integration remain subsequent phases. This
change introduces no scheduler, SQLite migration or premium feed.
