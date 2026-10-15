# Model A — frontend integration checkpoint

Checkpoint checkout: 6 October 2026, `feature/backend-web-integration`.
Merge `b62e30c` includes the collaborator's `frontend/website` commit `1378033`.
The subsequent hardening and demo fixes remain local and uncommitted. This is
not a fresh claim that no newer remote commits exist. Do not replace these
frontend files with an older branch snapshot.

## Implementation choice

Model A is the user's chosen active flow: Go/WASM computes PRICE/EMA9/EMA20/RSI14
for each series; the Go server applies the authorized private rule via WebSocket.
Model B remains a test-only research comparison, not a production endpoint.
This choice is not a claim of proven production efficiency or advisor approval.

## Runtime contract (available in the working branch)

1. Login with `POST /api/auth/login`. Preserve both rotating identity tokens.
2. Open an app session with `POST /api/v1/sessions`; business requests require
   `Authorization: Bearer ...` and `X-App-Session: ...`.
3. Read `GET /api/v1/capabilities`. Existing core fields remain unchanged.
   `screening` additionally declares Model A, client/server responsibilities,
   `series` dataset content, required owned universe, three symbols per batch,
   1,000 candidates, and a 262,144-byte WebSocket message limit.
4. Read `GET /api/v1/stocks` and create/select an owned bundle using
   `/api/v1/stock-universes`. Symbols come from the server catalog; do not use
   provider-specific Yahoo identifiers as universe members.
5. Select a permitted rule from `/api/v1/rules`.
6. Prepare a snapshot with the following body:

   ```json
   {"purpose":"screen","rule_id":"default-scalping-v1","universe_id":"<owned-universe-id>"}
   ```

   Endpoint: `POST /api/v1/datasets/prepare`. Client-supplied owner, date range,
   provider symbol list, or arbitrary market fields are not accepted.
7. Read `/api/v1/datasets/{dataset_id}/content`. Dynamic content is `series[]`;
   run the single-symbol WASM feature bridge once for each series and concatenate
   the candidates. Verify content checksum and engine/schema versions.
8. Issue a grant at `/api/v1/compute-grants`, using the actual manifest and rule
   identifiers/hashes/versions, then request a one-use ticket at
   `/api/v1/screener/socket-tickets` with protocol `screener-private-1`.
9. Use the returned WebSocket path and ticket. Send compact feature candidates,
   not OHLCV or the rule definition. Respect declared count and encoded-byte
   limits. Reconnect requires a fresh ticket; tickets cannot be reused.
10. Render per-symbol decisions. Missing/denied/unavailable data is an error or
    explicit warning, never a fabricated successful screening result.

## Current frontend changes still required

The current connector sends `purpose/rule_id/universe_id` and reads `series[]`.
The orchestrator runs the feature worker per series, then concatenates all
candidates into one grant/ticket/WebSocket batch. Opening a socket per symbol
would exceed the two-sockets-per-user limit for a three-symbol universe; the
server limit is deliberately unchanged. It verifies combined candidate limits
and decision symbol/timestamp order before attaching feature evidence.

These changes have five focused orchestration regression tests. The frontend
still needs automatic Supabase refresh-token retention/refresh and app-session
rotation; backend contracts already exist. Browser login was observed, but the
first real account lacked `screener` entitlement and was correctly denied.
The user's replacement account already had access: login, creation of a
three-symbol demo universe and screening with Default Scalping succeeded on
6 October. All three latest decisions were `No match`, quality `complete`.
There was one grant/ticket/socket; no role or entitlement was changed. Do not
weaken guards or fabricate permissions/results. A Node-hosted WASM test alone
is not a browser UI test. See [current progress](BACKEND_PROGRESS.md).

## Repeatable backend verification

From `backend/`, against a **fresh disposable loopback database** named
`signalgen_test` only:

```sh
go run ./cmd/schematest -repo-root ..
SIGNALGEN_RUN_WASM_INTEGRATION=1 go test -race ./...
go vet ./...
```

Set `SIGNALGEN_TEST_PG_URL` to that isolated database first; never point these
tests at the real Supabase database. They truncate their own test fixtures.
Go and Node 24 are required for actual WASM verification. CI config includes
this check. The tests exercise three series, 63 candidates, native/WASM feature
parity, and private decision parity over WebSocket with real Postgres storage.
Identity and market data remain deterministic adapters in this test.

## Explicit remaining product decisions

Backtest fills/P&L and journal accounting still require final entry/exit,
fees/slippage, ordering and rounding policy. Provider rights and production
availability need external verification. The restricted runtime database role
is configured and tested, but cloud backup recovery, full browser integration,
production deployment and separated CPU/RAM measurements are not claimed
complete by local test success. No automatic payment or broker trading is implemented.
