# Backend progress checkpoint — 2026-10-06

Branch: `feature/backend-screening-reliability`. This is an implementation
checkpoint, not a claim that the whole PRD or thesis evaluation is complete.

## Implemented in this working branch

- Editable owner profile: `GET/PATCH /api/v1/account/profile`, name/bio validation,
  strict payload, bearer + app-session protection and atomic version checking.
  Profile edits cannot modify email/password/role/status/entitlement.
- Additive Postgres profile migration, retained owner RLS and explicit checks
  that client roles cannot UPDATE the authorization-bearing profile table.
  This migration was applied to Supabase signalgen-2 on 6 October 2026 as
  20261006022639 after local tests. Columns/constraints/owner policy were
  verified; RLS remains enabled and authenticated cannot UPDATE the table.
- Python tests/source/installer and Electron source separated under `legacy/`.
  Original runtime DBs, volumes and running legacy containers are preserved.

- Public market-data cache with coalesced fetches, bounded retries/body size,
  strict normalized OHLCV validation and resource limits.
- Private owner-bound multi-symbol dataset snapshots with expiry/capacity limits.
- Per-symbol decision evaluation through the frozen single-symbol core.
- Dataset/grant binding checks at ticket issue and WebSocket upgrade.
- Supabase identity refresh gateway with complete rotating token pairs.
- Atomic current app-session secret rotation, preserving original expiry.
- Authorization recheck after receiving the WebSocket batch.
- Bounded pending tickets/concurrent sockets and shutdown cancellation.
- Database schema/ownership checks, CI configuration, API/Postman contracts.
- Structural cleanup: domain screening authorization outside the API adapter,
  explicit `contracts.go` interfaces, feature-grouped API tests, and a beginner
  code-reading guide. Other handler workflows remain incremental refactor work.
- API adapters grouped into feature subpackages, with shared transport guards,
  a small server composition root, separate contract tests, and a package-boundary
  regression check. Endpoint paths and JSON envelopes are preserved.
- Compute-grant issuance extracted into an HTTP-independent service with narrow
  contracts, centralized purpose policy, staged error mapping, rejection-before-
  write tests, and explicit rejection of client-supplied owner/session fields.
- Dataset preparation/reads moved to an access service. Domain and HTTP tests
  cover rejected preparation, verified-owner propagation, revoked reads,
  withheld OHLCV/metadata, capacity retry headers and safe provider errors.
- Model A selected for active implementation; capabilities explicitly declare
  owned-universe/series orchestration and shared WebSocket limits, without
  changing the frozen single-symbol core or advertising unsupported backtest.
- Actual Go/WASM feature bridge tested under Node, compared with native results,
  and used in the Postgres/WebSocket contract test. Server match decisions are
  compared with native per-symbol rule evaluation, not just response counts.
- Backend CI enables Node/WASM integration and the Go race detector.

Detailed code responsibilities and test evidence:

- [Screening reliability](SCREENING_RELIABILITY.md)
- [Supabase refresh contract](AUTH_REFRESH.md)
- [App session and socket lifecycle](SESSION_AND_SOCKET_LIFECYCLE.md)
- [Model A frontend handoff and outstanding connector changes](MODEL_A_FRONTEND_HANDOFF.md)
- [Profile, feature status and legacy comparison instructions](PROFILE_AND_LEGACY.md)

Local verification on 6 October: all Go tests with race detector and actual
WASM/Postgres/WebSocket integration passed; Go vet passed; 6 migrations and
2 policy checks passed; 138 archived Python tests passed in a disposable
container using writable `/tmp` for SQLite; archived Electron typecheck passed.
The rebuilt Go image was healthy with `/health` and `/ready` returning 200
against the isolated database, and unauthenticated profile access returned 401.
All 122 tracked files selected for legacy relocation remain present at their
new paths. Legacy Windows installer packaging was not re-tested.
The relocated Python export script also matched all 7 frozen signal timestamps,
prices and indicator values under the documented 1e-9 parity tolerance.

## Still required before claiming a complete MVP

1. Frontend prepare payload, multi-series computation and current WASM artifacts;
   login-to-screening and automatic identity refresh against real services.
2. Model A staging measurements and the required research comparison, separated
   server/client resource metrics and advisor approval. Model A is selected for
   implementation; local fixture success is not a capacity/efficiency claim.
3. Approved trade execution/cost policy and exact baseline before extending
   backtest/P&L; do not invent financial outputs from signal-only fixtures.
4. Journal/portfolio implementation after cost/ordering/rounding policy approval.
5. Provider data rights and realistic availability/rate measurements.
6. Production least-privilege database role, TLS/proxy configuration, safe
   observability, backup/restore drill, and multi-replica resource/state design.
7. Publish/review this feature branch and run CI remotely when authorized.

Cloud deployment on 6 October is recorded below. Real account creation,
recovery email, payment and frontend feature edits are not part of this
checkpoint. Existing legacy references are preserved.

## Supabase deployment — 6 October 2026

All six local migration versions now match cloud migration history. Editable
profile columns/constraints are installed, existing account count is unchanged,
owner RLS is retained and client UPDATE privilege is absent. The latest Go image
returned `/health=200` and `/ready=200` against the configured cloud database.
The temporary verification container was removed; running user containers were
not replaced. Auth flows were not exercised against real users during deployment.

Security advisors still report legacy public trigger-function EXECUTE privileges
and disabled leaked-password protection; see `PROFILE_AND_LEGACY.md`. No new
advisor category was introduced by profile migration. `backend/.env` and all
tokens/passwords remain excluded from Git; each developer must privately provide
the server-only Postgres URL as shown in `backend/.env.example`.

## Local verification

The current refactored checkout was verified again on 2026-10-05 using a fresh,
disposable PostgreSQL 16 database named `signalgen_test`. No cloud Supabase
environment or existing application database was modified. Temporary API and
database containers were removed after verification.

- Full backend race tests with real isolated PostgreSQL integration: passed.
- Schema runner: five migrations, two SQL policy/ownership checks passed.
- Rotation: 16 concurrent old-token attempts, exactly one winner.
- Screening: three symbols, 63 candidates, 63 decisions through WebSocket.
- Actual WASM: three-symbol feature parity and private server decision parity
  passed with isolated Postgres. This is not a browser login-to-screening test.
- Authorization changes after upgrade and shutdown cancellation: passed.
- Go vet and diff whitespace checks: passed.
- Docker test and API runtime image builds: passed.
- Fresh runtime smoke test: `/health` and `/ready` returned HTTP 200; Docker
  healthcheck reported healthy. Auth used placeholder configuration, so these
  endpoints do not prove live Supabase login availability.
- Disposable backup/restore drill: `pg_dump`/`pg_restore` succeeded into a second
  isolated database, then the current Model A Docker image returned HTTP 200
  on `/health` and `/ready` and its healthcheck reported healthy. This verifies
  local schema recovery only, not cloud backups or production data recovery.
- Clean SIGTERM exit: passed at the earlier runtime checkpoint.
- OpenAPI local references and Postman/WebSocket JSON syntax: valid after the
  Model A capability update.

Identity and market data in integration tests are deterministic adapters. These
results do not establish cloud Auth availability, live provider reliability,
complete browser integration, or production throughput. This subsection records
the earlier local checkpoint; the branch is being published after the 6 October
deployment and regression checks. A remote CI result must be checked separately.
