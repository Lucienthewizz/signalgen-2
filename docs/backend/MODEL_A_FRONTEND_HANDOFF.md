# Model A — frontend integration checkpoint

Verified remote inspection: 5 October 2026, `git fetch origin` completed.
Latest frontend-specific branch:
`origin/frontend/website-account-recovery-and-landing-polish`, commit `c2198eb`
(29 September 2026). Its frontend commits are already ancestors of the current
backend branch; no new frontend commit needed merging at this checkpoint.
Do not replace newer local frontend files with an older branch snapshot.

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

The checked-in connector still sends the old fixture body from
`frontend/web/src/api/client.ts::prepareDataset`, including `symbols` and fixed
dates. `frontend/web/src/analysis/screener.ts` reads a top-level `symbol/candles`,
and its worker accepts only one series. These do not match the dynamic backend.
The client also does not yet retain/rotate the Supabase refresh token.

Backend guards must not be weakened to conceal this mismatch. Connecting the
UI requires changing the API connector, dataset types and worker orchestration;
no visual redesign is necessary. Browser login-to-screening verification must
be repeated after that work. A Node-hosted WASM test is not a browser UI test.

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
availability need external verification. Cloud backup recovery, least-privilege
deployment, browser integration and separated CPU/RAM measurements are not
claimed complete by local test success. No automatic payment or broker trading
is implemented.
