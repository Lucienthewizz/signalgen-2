# Market screening runtime repair — 17 November 2026

The source on `codex/backend-prof-local-integration` registers `/api/v1/screener/scans`, but the local port-8080 API still used image `sha256:28d5abecea14c8d9d71c4678789217f1275523f24f4d862e07de899e442ef039`. An unauthenticated POST returned HTTP 404 `RESOURCE_NOT_FOUND`.

The API binary was built offline from commit `5c6439d17d9c87b37c2e1dfa5ff14bf33c7607e5` using the existing Go toolchain image and module cache. The replacement runtime retains the previous runtime base and changes the API executable. Its image ID is `sha256:f3adb72e2c32273363a7ac1383c76daa5a1eef319d6a51b8fc9d156562d2e518`.

Only the Compose `go-api` service was recreated. The former image remains tagged `signalgen20-go-api:before-screening-endpoint-fix-20261116` for rollback. The normal local API image tag now refers to the replacement. The frontend source, database schema, and environment files were not changed.

After replacement, the API was healthy. Unauthenticated POST requests returned HTTP 401 `AUTH_REQUIRED` through both port 8080 and the port-5174 frontend proxy. This confirms route registration without bypassing authentication.

A rule named `TEST - Full Market Valid Prices` was saved through the account UI: BUY, AND, Close price > 0.01, cooldown 0 seconds. The positive threshold follows the existing rule validation. It is a broad matching test, not a trading recommendation or a promise that every catalog entry has sufficient data.

An authenticated market screening smoke test selected the entire IDX catalog and signal date 13 November 2026. The UI showed 41/962 stocks processed with zero failures and BUY rows before the test was stopped. This confirms the authenticated screening path; it is not a completed whole-catalog benchmark.

The same saved rule was available in Backtesting → Analyse every signal. An authenticated run selected the entire IDX catalog, 1–31 October 2026, and a three-candle horizon. After stopping the smoke test, the UI retained 34/962 completed stocks, zero failures, 748 signals, 748 evaluated swing outcomes, and zero missing future outcomes. The UI explicitly marked the result incomplete. No full-catalog completion time or speed improvement is claimed.
