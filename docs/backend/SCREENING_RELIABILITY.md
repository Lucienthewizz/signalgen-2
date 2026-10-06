# Backend screening reliability

Implemented on `feature/backend-screening-reliability`.

## Data flow and responsibility

1. The API verifies bearer identity, app session, account status, and screener entitlement.
2. The universe repository resolves the authenticated owner's approved instruments.
3. `marketdata.CachedProvider` shares only public normalized OHLCV. Identical
   instrument/provider-symbol/output-size requests share one upstream fetch.
4. `dataset.DynamicStore` creates an immutable private snapshot with an owner,
   checksum, version, and expiry. Its handles are never shared between users.
5. A compute grant binds that owner's session, dataset, rule hash, and versions.
6. Ticket creation and WebSocket upgrade both revalidate the dataset binding.
7. `screener.EvaluateBatch` restricts candidate symbols and dates to the manifest,
   then calls the existing decision core separately per symbol. This preserves
   per-stock cooldown and the frozen single-symbol calculation.

The core still computes one instrument at a time. A frontend worker should call
`signalgenComputeFeatures` for each `series` entry and combine the candidate lists
into one WebSocket message. Results retain the input candidate order. The engine
and worker versions stay unchanged because indicator formulas are unchanged.

## Current bounds

| Resource | Default |
| --- | --- |
| Upstream cache TTL | 5 minutes |
| Public cache entries / aggregate candles | 64 / 32,000 |
| Distinct simultaneous upstream fetches | 8 |
| Shared fetch deadline | 15 seconds per instrument |
| Yahoo attempts | 2 maximum, only transient network/429/502/503/504 failures |
| Retry delay | 250 ms by default; honor Retry-After up to 1 second |
| Provider response body | 4 MiB per instrument |
| Snapshot TTL | 15 minutes |
| Active private snapshots | 128 total, 16 per owner |
| Private snapshot content budget | 32 MiB |
| Dataset instruments / candles | 3 instruments, up to 100 candles each |
| WebSocket batch / message | 1,000 candidates / 256 KiB |

Cache expiry triggers a fresh fetch; expired public data is never served as a
fallback. Provider errors and invalid responses are not cached. A cancelled
caller stops waiting without cancelling another user's shared fetch.

Invalid OHLC, non-finite prices, negative volumes, duplicate/unordered timestamps,
unexpected symbols, mismatched arrays, malformed JSON, and oversized provider
bodies are rejected. Missing OHLCV values are skipped; at least 20 valid candles
must remain. Yahoo's unofficial public endpoint remains an academic MVP provider;
these controls do not establish commercial reliability or redistribution rights.

Snapshot capacity does not evict active handles. Preparation returns HTTP 503
with `Retry-After: 60` when capacity is full. Reads of expired/missing handles
return 404. Clients should prepare a new dataset/grant/ticket after expiry or
backend restart. No private data is written to shared browser/CDN caches.

## Verification

```sh
cd backend
go test -race ./internal/marketdata ./internal/dataset ./internal/screener ./internal/api/...
go vet ./...
```

For the database integration check, start an isolated empty loopback PostgreSQL
database named exactly `signalgen_test`, then:

```sh
export SIGNALGEN_TEST_PG_URL='postgres://postgres:password@127.0.0.1:55433/signalgen_test?sslmode=disable'
go run ./cmd/schematest -repo-root ..
go test -race ./internal/api/tests -run '^TestPostgresAPIContractsAndOwnership$' -count=1 -v
```

That test uses real Postgres profiles, rules, universes, sessions, and grants,
plus real WebSocket transport. Identity and market data are deterministic test
adapters. It checks two-user isolation and a 3-symbol/63-candidate/63-decision
screening flow against the frozen fixture. It also confirms repeated prepares
reuse cached upstream data. CI provisions PostgreSQL 16 and runs this check as
part of the backend test suite.

Local verification on 2026-10-05 passed: the full `go test -race ./...`
suite with Postgres integration enabled, `go vet ./...`, five migrations and
both SQL policy checks, and the Go 1.26 Docker runtime build. A temporary API
container returned 200 from `/health` and `/ready` against the isolated test
database. The temporary containers were removed afterward. GitHub Actions is
configured but has not run for these unpublished changes; cloud identity and
live Yahoo screening were not part of this verification.

## Remaining integration work

The web frontend still needs the current `rule_id + universe_id` prepare request,
`ohlcv-multi-1` series handling, and rebuilt `core-0.3.0`/`worker-2` artifacts.
Backend tests do not establish successful login-to-screening browser integration.

The cache, snapshots, and tickets are process-local. Multi-replica deployment
needs shared storage or an explicit routing design. Client features remain
untrusted input: scope checks cannot attest honest WASM execution, and results
must not be used as authoritative competition, billing, or trading evidence.
Backtest fill/cost policy, journal/portfolio accounting, auth refresh, provider
licensing, backup/restore, and staging measurements remain separate work.
