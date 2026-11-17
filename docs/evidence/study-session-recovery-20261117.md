# Screening and backtest session recovery

The UI now checks the server for an existing reservation before allowing another run. `GET /api/v1/screener/scans` and `GET /api/v1/backtests/studies` return only the authenticated account's current app session and purpose, with `Cache-Control: private, no-store`. Expired reservations are released.

A recovered reservation is shown with its market and dates. The user explicitly selects **Cancel previous run**; the application does not automatically cancel work that may be running in another tab. Cancellation failures keep Start disabled. A 404 on cancellation means the reservation has already disappeared and permits a new run. Capacity conflicts recheck server state; global capacity and lookup failures offer a retry. This recovers the ability to start again, not interrupted computation or lost browser results.

## Verification

- Offline backend tests: `go test ./internal/api/...` passed, including owner/session/purpose isolation and cancel-then-create recovery.
- Browser recovery fixtures passed for screening and backtest at 1456px and 390px: discovery after reload, no automatic cancellation, cancellation failure/retry, concurrent capacity conflict, and lookup failure/retry. The screening fixture also checks global server capacity.
- Existing screening compute regression passed with real WASM and synthetic account/provider data, in dark/light themes at desktop/mobile widths.
- Backtest compute regression passed with its unrelated configuration-layout prelude omitted. The complete existing test stops at its TP/SL alignment assertion at 1440px; this change does not alter those fields or their layout.
- Web production build and performance budgets passed.
- Local backend image was rebuilt offline and activated. FE on port 5174 and BE on port 8080 returned 200 after restart. Unauthenticated requests to both new GET routes returned 401.

Recovery browser check:

```sh
node frontend/web/scripts/test-study-recovery.mjs
```

The test uses synthetic accounts and intercepted API responses, and does not cancel real account runs.
