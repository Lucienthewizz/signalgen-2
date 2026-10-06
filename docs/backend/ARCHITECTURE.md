# SignalGen Go Backend Architecture

This document is the reading map for the active Go/WASM backend. It explains
where code belongs, how a request moves through the system, and which storage
owns each kind of data.

## Design goals

1. Keep HTTP details separate from business rules and persistence.
2. Keep authentication (identity) separate from authorization (permission).
3. Keep the reusable screener calculation in `backend/core` so the same Go
   code can run on the server and as WebAssembly in the browser.
4. Depend on small interfaces at the HTTP boundary; the active runtime uses
   Supabase Postgres through pgxpool and legacy stores remain for tests.
5. Keep endpoint paths and JSON responses stable for the web frontend.

## Reading order for beginners

Follow one request from the outside to the inside:

1. `cmd/api/main.go` wires real dependencies and starts the process.
2. Open `internal/<feature>/routes.go` to see that feature's endpoints.
3. `internal/api/routes.go` only composes those feature route groups.
4. Open `internal/api/<feature>/handlers.go` for HTTP mapping.
5. Read `contracts.go` for the feature-owned interfaces. Follow the concrete
   implementation in `repository.go`, `authorization.go`, or the provider file.
6. Read `backend/core` only for indicator and decision calculations.

Example:

```text
POST /api/v1/compute-grants
  -> internal/compute/routes.go
  -> internal/api/routes.go (composition)
  -> internal/api/compute/handlers.go
  -> internal/compute/issuance.go (permission + binding workflow)
  -> dataset.Manifest reader + rules.Get reader + compute.Create writer
  -> internal/dataset, internal/rules, internal/compute
```

## Folder responsibilities

```text
backend/
├── cmd/
│   ├── api/             # Composition root and HTTP process
│   ├── admin/           # Local operator/bootstrap CLI
│   ├── importlegacy/    # Explicit SQLite archive import, not API startup
│   ├── schematest/      # Isolated database migration/ownership test runner
│   ├── wasm/            # JavaScript/WASM adapter around backend/core
│   ├── wasmmanifest/    # Generates integrity/version metadata for WASM
│   └── healthcheck/     # Container health-check command
├── core/                # Pure, portable indicator and decision logic
├── internal/
│   ├── platform/
│   │   ├── database/    # pgxpool connection and Postgres readiness
│   │   ├── http/        # Gin adapter, JSON, request ID, CORS
│   │   └── websocket/   # Low-level WebSocket connection adapter
│   ├── api/             # Server composition, feature HTTP adapters, tests
│   ├── auth/            # Supabase identity provider, service, feature routes
│   ├── account/         # Profiles/status and Postgres repository
│   ├── entitlement/     # Feature-access contract and model
│   ├── subscription/    # Plans, lifecycle, audit events, feature mapping
│   ├── operator/        # Audited privileged mutations and routes
│   ├── session/         # App sessions, device ownership, routes, repository
│   ├── rules/           # Owner rules, routes, Postgres repository
│   ├── dataset/         # Owner-bound snapshots, test fixture, and routes
│   ├── marketdata/      # Yahoo provider, validation, cache, and retry limits
│   ├── universe/        # Shared catalog and private user stock universes
│   ├── compute/         # Compute grants, routes, Postgres repository
│   ├── screener/        # Authorization service, decisions, tickets, socket limits
│   ├── ratelimit/       # Mutation/auth request throttling
│   └── access/          # Compatibility types + legacy SQLite repository
└── scripts/             # Active Go/WASM verification tools

supabase/migrations/     # Monorepo-wide Supabase schema migrations
legacy/python/           # Archived Python source, tests, scripts and installer
legacy/desktop/          # Archived Electron shell and renderer
```

The Supabase folder intentionally stays at repository root rather than under
`backend/`. The Supabase CLI expects that conventional location, and the schema
is an application resource shared by backend deployment and local tooling.

## HTTP package map

```text
internal/api/
├── server.go          # Constructor and http.Handler entry point
├── config.go          # Validated options: CORS, stores, limits, lifecycle
├── contracts.go       # Public aliases for feature-owned dependency contracts
├── defaults.go        # Safe fallback adapters used by optional configuration
├── routes.go          # Connect feature routes to independent handlers
├── shared/            # Injection context, common guards and error mapping
├── auth/              # Register, login, refresh, me, password recovery
├── account/           # Account summary, session list and devices
├── sessions/          # Create, revoke, and rotate app-session secret
├── rules/             # Baseline metadata and private user rule CRUD
├── universes/         # Shared catalog and owner-scoped stock universes
├── datasets/          # Prepare, manifest and protected OHLCV content
├── compute/           # Issue grants bound to session/dataset/rule/version
├── screener/          # Ticket, WebSocket adapter, protocol and service wiring
├── subscriptions/     # Plans, owner subscription and operator activation
├── operator/          # Privileged audited grants and role changes
├── system/            # Health, readiness, API metadata and capabilities
└── tests/             # Cross-feature HTTP/WebSocket and persistence tests
```

Each feature folder is an independent Go package with a `Handler`. It does not
import the parent `api` package, preventing circular imports. `shared.Context`
holds injected backend dependencies, not request data. It is created once at
startup and must not be mutated during live requests. Feature handlers use its
common guards; domain services and repositories remain outside `api`.
Generic JSON, CORS and request IDs are still implemented in `platform/http`.

A handler should only:

1. parse and validate HTTP input;
2. call a domain interface;
3. translate domain errors to HTTP errors;
4. write the response.

Indicator formulas, domain authorization policy, and SQL should not grow inside
handlers. The screener's rule resolution and pre-scoring permission recheck now
live in `internal/screener/authorization.go`. Compute-grant issuance now lives
in `internal/compute/issuance.go`, with a client-only input type and narrow
consumer-owned interfaces. Its staged domain errors are mapped to the unchanged
HTTP contract by `api/compute/errors.go`. Purpose-to-feature policy belongs to
`internal/entitlement/purpose.go`, not the HTTP adapter.
Other existing handler workflows still need incremental service extraction;
this does not claim the entire API has been refactored.
Dataset preparation and protected reads now use `internal/dataset/service.go`.
The service owns entitlement/rule validation; `api/datasets/errors.go` preserves
HTTP errors, capacity retry headers and safe provider-failure messages. Provider
and snapshot mechanics remain the repository's responsibility.
Transport guards, body validation and protocol error mapping remain in `api`.

## File naming and tests

- `model.go`: values and domain errors used by a feature.
- `contracts.go`: interfaces only, not an implementation of every operation.
- `repository.go`: active Postgres implementation of a feature contract.
- `legacy_sqlite_repository.go`: compatibility adapter, never wired by `cmd/api`.
- `routes.go`: feature endpoint registration.
- `api/<feature>/handlers.go`: HTTP adapters (comparable to Express controllers).
- `authorization.go`, `decision.go`: actual screener policy/calculation services.
- `compute/issuance.go`: grant permission/binding workflow, independent of HTTP.
- `dataset/service.go`: permission/rule policy for preparation and protected reads.
- `*_test.go`: tests colocated with the code they exercise.

API tests live in `api/tests` and are grouped by feature. They import the API
constructor as a separate package. `test_helpers_test.go` contains shared doubles
and assertions. `legacy_integration_test.go` explicitly isolates SQLite baseline
checks; `postgres_integration_test.go` exercises the active persistence path.
Splitting files does not change test names or assertions.

## Authentication and authorization boundary

```text
Supabase bearer token -> proves identity
X-App-Session token    -> proves an allowed SignalGen installation
account status         -> proves the account is active
effective entitlement  -> manual grant or active subscription enables a feature
compute grant          -> approves one exact computation context
socket ticket          -> opens one short-lived WebSocket connection
```

Supabase user metadata is not trusted for SignalGen role or entitlement
decisions. Those remain server-owned.

## Current storage ownership

SignalGen stores application state in Supabase Postgres after the web migration.

| Storage | Current responsibility |
|---|---|
| Supabase Auth | User ID, email/password identity, access/recovery tokens |
| Supabase Postgres (`signalgen` schema) | Profiles, roles, account status, manual grants, subscriptions, audit events, app sessions, device state, user rules, stock universes/catalog, compute grants |
| Process memory | One-use tickets, rate-limit counters, socket capacity, shared market-data cache, owner-bound expiring dataset snapshots |
| Yahoo Finance provider | Historical OHLCV input for the current MVP; availability/data rights are not production guarantees |
| Fixture JSON | Deterministic test/experiment input, not the default active provider |
| WebSocket | Transport only; it stores no durable data |

SQLite repositories remain inside selected feature packages for legacy
comparisons and existing unit fixtures. The active Go API never constructs
those repositories, opens a SQLite file, or mounts its former volume.

## Production storage

Supabase Auth owns identity. Supabase Postgres schema `signalgen` owns durable
application data. The private `legacy` schema contains only the lossless
SQLite archive, while application tables must not be created in `public`.
The `signalgen` and `legacy` schemas are not exposed through Supabase Data API;
the browser accesses application data through the Go API.

The grants and owner-scoped RLS policies on selected `signalgen` tables do not
expose the custom schema by themselves. They are a separately tested
defense-in-depth boundary if direct Data API access is ever approved later.
Changing the Supabase exposed-schema setting is therefore an architecture and
security change, not a frontend convenience setting. The Go API verifies
identity, session, role, ownership, and entitlement at its own boundary. The
current Postgres connection user can bypass RLS, so SQL owner filters remain
mandatory. A future dedicated least-privilege database role should be tested
before production deployment.

Tickets, socket counters, cache and dataset snapshots remain process-local.
Multiple API replicas need an explicit shared-state/routing design before they
can serve the same ticket and dataset flow. Runtime dataset preparation uses
the cached Yahoo Finance provider. Production provider approval and reliability
validation remain open; a live fetch is not evidence of commercial data rights.

## Why interfaces matter for migration

Handlers use feature-owned interfaces such as `account.Service`,
`session.Repository`, `subscription.Service`, and `rules.Repository`, not concrete SQL calls. The API
composition layer uses readable aliases for those contracts and the active
runtime composes them with Postgres implementations:

```text
active: API -> account.Service -> account.PostgresRepository -> pgxpool
legacy: API tests -> AccessStore interface -> SQLite fixture
```

The route and frontend contract stay stable while persistence changes.
