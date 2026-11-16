# Whole-catalog study timing

Measured on 16 November 2026 to answer the professor's remark that a
whole-catalog backtest was far slower than his own tool (under three minutes
once data is present).

## Data

- Symbol list: the 962 IDX tickers in the 2 November catalog audit
  (`catalog_sha256 aa9e9d5b…`). This is the frozen application catalog at that
  date, not a newer IDX export.
- History: Yahoo Finance daily candles, five years per ticker, fetched serially
  with `backend/scripts/catalogbench fetch` (0.6 s pause). 882 tickers returned
  data; 80 failed (40 HTTP 404, 39 invalid data, 1 other). The saved files stay
  outside the repository.
- Study: October 2026, T+3, TP 2%, SL 1%, rule "Bearish MA Cross"
  (`MA9 CROSS_DOWN MA20`), the example used in the 11 November meeting.

## Results

`TestStudyRealCatalogTiming` drives the real HTTP routes in process: create
study, prepare/release each batch of 10, dataset content, compute grant,
private rule decision. Features and outcomes run in native Go; the browser runs
the same core in WASM. `SIGNALGEN_REAL_RTT` adds a fixed delay per request to
stand in for network latency.

| Run (882 tickers, 89 batches) | Total | Rate-limit wait |
| --- | --- | --- |
| Before, production limiter 60/min, local | 14 min 1 s | 14 min (14 refusals) |
| After, production limiter 60/min, local | 0.62 s | 0 |
| After, 50 ms per request, sequential | 2 min 46 s | 0 |
| After, 50 ms per request, prefetch 4 | 1 min 21 s | 0 |

The 50 ms rows ran with `-race`. Computation alone for the same catalog
(`catalogbench bench`, native Go) is 0.3 s for October and 0.6 s for a full
year. A 100-ticker run on the old code waited 60 s for the limiter after the
60th grant.

## Cause and change

Speed was bounded by the per-user mutation limiter, not by computation. Each
stock needs one compute grant and one private decision, and each was limited to
60 per minute, so 882 stocks took 14 minutes.
Batch prepare/release calls shared another 60 per minute.

Changes:

- Grants and decisions for a live study snapshot now use a fixed quota of
  three per prepared stock (`dataset.MaxStudyDatasetUses`) instead of the
  per-minute limiter. Other datasets and unknown grants still use the limiter.
  Study admission (32 contexts, 12 batches) already bounds total load.
- Batch prepare and release no longer use the limiter. Each batch can be
  prepared successfully at most five times; capacity refusals are not counted.
  Study creation keeps the limiter.
- The browser fetches dataset content and grants for a batch up front, at most
  four requests at once. Features, decisions and storage still run in order.

## Verification

- New `TestStudyCallsUseFixedQuotaInsteadOfMinuteLimiter`: with a limiter that
  rejects grants and decisions, all ten stocks in a batch still complete; the
  fourth grant or decision for a stock returns `409 STUDY_RETRY_LIMIT`; an
  unknown grant still gets `429`; the sixth successful prepare of a batch is
  refused. The existing signals rate-limit test still returns `429` for
  non-study datasets.
- `go test ./internal/...` and `go test -race ./internal/api/...` pass.
- Frontend: 279 unit tests (one new prefetch test), typecheck and Prettier pass.
- The browser-to-real-API harness (React, Web Worker/WASM, IndexedDB, packaged
  API, PostgreSQL) passed 59 assertions with the prefetch change applied to an
  otherwise unchanged checkout. Its pinned API image predates the server-side
  quota, so that part is covered by the Go tests only. The harness now skips
  `_test.go` files in its source-equality check; merged test files had made it
  refuse to start.

## Limits

- No browser timing on the full catalog: WASM and IndexedDB cost is not in the
  table. Earlier measurements put WASM at roughly 5× native, which is still a
  few seconds for this catalog.
- The fixed RTT is a model, not a measured deployment latency.
- 80 tickers had no usable Yahoo data and are counted as missing coverage.
- Data was served from saved files. A cold server cache fetches Yahoo per
  ticker (three at a time per batch); the opt-in scheduler is meant to keep the
  archive warm so studies do not wait on Yahoo.

## Reproduce

```sh
cd backend
go build -o /tmp/catalogbench ./scripts/catalogbench
/tmp/catalogbench fetch -symbols symbols.txt -data /private/dir
/tmp/catalogbench bench -data /private/dir -from 2026-10-01 -to 2026-10-31 -steps 3
SIGNALGEN_REAL_CATALOG_DIR=/private/dir SIGNALGEN_REAL_RATE_LIMIT=60 \
SIGNALGEN_REAL_RTT=50ms SIGNALGEN_REAL_PREFETCH=4 \
  go test ./internal/api/tests/ -run TestStudyRealCatalogTiming -v -count=1 -timeout 30m
```
