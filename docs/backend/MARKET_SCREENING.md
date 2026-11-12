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

These tests have not run in this session. The execution sandbox could not set its
required OS memory limit. Build, test, browser and live-provider verification
remain pending. Formatting and source review do not establish runtime behavior.

Performance optimization, scheduled incremental collection, evaluation-choice
refinements and premium-provider integration remain subsequent phases. This
change introduces no scheduler, SQLite migration or premium feed.
