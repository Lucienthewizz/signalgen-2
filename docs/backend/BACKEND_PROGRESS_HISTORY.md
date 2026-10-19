# Backend progress — historical checkpoints through 6 October 2026

Arsip catatan bertahap. Nomor migration, branch, status frontend dan temuan
security di bawah mengikuti waktu masing-masing checkpoint, bukan status terkini.
Untuk laporan aktif gunakan [backend progress](BACKEND_PROGRESS.md) dan
[persiapan asis 7 Oktober](../ASIS_2026_10_07.md).

Branch: `feature/backend-screening-reliability`. This is an implementation
checkpoint, not a claim that the whole PRD or thesis evaluation is complete.

## Implemented in this working branch

- Operator/admin backend extension: paginated account metadata, audited
  suspend/reactivation and target-scoped audit metadata. Status/revoked app
  sessions/audit commit together; session creation and role/status races retain
  account safety and an active operator. Audit-action/index migration was
  applied to cloud on 6 October 2026. No admin UI/private rule access added. See
  [admin backend](ADMIN_BACKEND.md).
- Screening-specific observability: bounded outcomes, contract candidate/text
  byte counts and wall-clock stage durations with server-generated correlation
  IDs. Result computation/HTTP upgrade is not treated as successful delivery.
  Socket adapter separated from ticket handlers; frozen Model A calculations and
  protocol envelopes retained. No schema/cloud migration needed. See
  [screening observations](SCREENING_OBSERVABILITY.md).
- Safe operational telemetry: bounded process-local request/status/byte/duration
  counters, JSON events with server-generated IDs and route templates, periodic
  Go-runtime summaries, redacted Gin panic recovery and Docker log rotation.
  No public metrics endpoint, credential/request dumps or scoring-success claim
  from HTTP 101. Allowlisted frontend origins can inspect request/retry/cache
  headers. See [observability](OBSERVABILITY.md) for limitations and tests.
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

Admin verification on 6 October: the complete Go race suite with actual
Postgres/WASM/WebSocket integration and Go vet passed. The isolated schema
runner passed 7 migrations and 2 policy checks, including backend-only audit
privileges. Admin tests cover bearer/session/active-role denial, strict filters
and forged actor input, no-store metadata, cursor pages, stale status, atomic
revocation/audit rollback, reactivation without session resurrection, twelve
concurrent session creations and a mixed role/status last-operator race.
The earlier race scenario was also repeated three times successfully.

OpenAPI validated; the read-only admin Postman collection and scripts parsed
with no filled credentials. Image `signalgen-admin:verified` built, its test
container was healthy, health/readiness returned 200, and all three admin paths
without login returned 401. Runtime logs retained only the route template (not
target/reason canaries); SIGTERM exited 0 with final HTTP in-flight count 0.
At this local verification checkpoint, no real operator/user, cloud Auth or cloud
database was modified. The later cloud schema deployment is recorded below.
Admin UI and Git commit/push remain outstanding; existing
containers/volumes were preserved.

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
7. Review the published feature branch and confirm remote CI. Commit 74415ec
   was pushed and local/remote SHA equality verified on 6 October; the later
   Gin documentation and observability changes are not yet committed/pushed.

Observability regression on 6 October: the full Go race suite with isolated
Postgres and actual WASM passed, including the Model A contracts with telemetry
enabled. Go vet passed; all 6 migrations and 2 ownership/schema policy checks
passed. A fresh Docker runtime image also built successfully. This test did not
modify cloud Supabase or contact real Auth users/provider services. Telemetry
is an operational foundation; staging metrics/production hardening remain open.

Docker smoke checks returned health/readiness 200, profile without bearer 401,
invalid socket ticket 401, unknown path 404, and allowed CORS preflight 204.
The runtime JSON-log privacy check found no canary ticket/query/resource IDs.
The tested process exited 0 on SIGTERM with final in-flight count 0, and the
Docker log driver confirmed three 10 MB files. Temporary test containers were
removed; existing user containers/volumes were not replaced.

Screening observability verification on 6 October: the full Go race suite,
Go vet, 6 migrations and 2 policy checks passed against isolated PostgreSQL 16.
A focused integration rerun with both observers enabled confirmed actual WASM
feature parity for 3 series and 63 private WebSocket decisions. Malformed,
binary and oversized frames, replay, revoked permissions, dependency failures,
shutdown cancellation and failed result writes passed their outcome assertions.
The oversized-frame test exposed a read-error classification issue; matching
the transport's `ErrMessageTooBig` sentinel corrected it without relaxing the
read limit or changing the client contract.

Image `signalgen-screening-observability:verified` built and its temporary
runtime was healthy. `/health` and `/ready` returned 200; profile/ticket denial
returned 401; an unknown path returned 404. Runtime logs contained one rejected
screening attempt, zero written results and no private query/ticket canaries.
SIGTERM exited 0 with final summaries and HTTP in-flight count 0. No cloud
Supabase migration, real Auth login or live provider request was performed.
These latest changes remain local, uncommitted and unpushed.

Cloud deployment on 6 October is recorded below. Real account creation,
recovery email, payment and frontend feature edits are not part of this
checkpoint. Existing legacy references are preserved.

## Supabase deployment — 6 October 2026

At the profile deployment checkpoint, the six then-existing local migrations
matched cloud migration history. The seventh migration for admin status
audits/indexes, `20261006053327_operator_account_status`, was subsequently applied
through Supabase CLI after a dry-run showed this as the sole pending migration.
All seven local migration versions now match the cloud history. The audit action
constraint is validated, the target/descending-ID index is valid and ready,
audit RLS remains enabled, and anon/authenticated cannot SELECT audit rows;
authenticated cannot INSERT them. Counts remained 3 account profiles, 17 app
sessions, 0 user rules and 6 audit events. No live account mutation or Auth login
was performed. Security advisors have the same categories/counts as before this
admin migration, including the existing public-function/password warnings.
This does not deploy the latest API image or establish end-to-end admin behavior.
Editable
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
