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
4. Open the matching `internal/api/*_handlers.go` adapter for HTTP mapping.
5. Follow the feature-owned interface in `service.go` to its repository.
6. Read `backend/core` only for indicator and decision calculations.

Example:

```text
POST /api/v1/compute-grants
  -> internal/compute/routes.go
  -> internal/api/routes.go (composition)
  -> internal/api/dataset_handlers.go
  -> dataset.Repository + rules.Repository + compute.Repository
  -> internal/dataset, internal/rules, internal/compute
```

## Folder responsibilities

```text
backend/
├── cmd/
│   ├── api/             # Composition root and HTTP process
│   ├── admin/           # Local operator/bootstrap CLI
│   ├── wasm/            # JavaScript/WASM adapter around backend/core
│   ├── wasmmanifest/    # Generates integrity/version metadata for WASM
│   └── healthcheck/     # Container health-check command
├── core/                # Pure, portable indicator and decision logic
├── internal/
│   ├── platform/
│   │   ├── database/    # pgxpool connection and Postgres readiness
│   │   ├── http/        # Gin adapter, JSON, request ID, CORS
│   │   └── websocket/   # Low-level WebSocket connection adapter
│   ├── api/             # Thin composition and HTTP input/output adapters
│   ├── auth/            # Supabase identity provider, service, feature routes
│   ├── account/         # Profiles/status and Postgres repository
│   ├── entitlement/     # Feature-access contract and model
│   ├── subscription/    # Plans, lifecycle, audit events, feature mapping
│   ├── operator/        # Audited privileged mutations and routes
│   ├── session/         # App sessions, device ownership, routes, repository
│   ├── rules/           # Owner rules, routes, Postgres repository
│   ├── dataset/         # Data source contract, fixture, and routes
│   ├── compute/         # Compute grants, routes, Postgres repository
│   ├── screener/        # WebSocket ticket contract, routes, ticket store
│   ├── ratelimit/       # Mutation/auth request throttling
│   └── access/          # Compatibility types + legacy SQLite repository
└── app/                 # Legacy Python/FastAPI baseline, not the active API

supabase/migrations/     # Monorepo-wide Supabase schema migrations
```

The Supabase folder intentionally stays at repository root rather than under
`backend/`. The Supabase CLI expects that conventional location, and the schema
is an application resource shared by backend deployment and local tooling.

## HTTP package map

- `server.go`: dependency composition, configuration options, constructor.
- `routes.go`: connects feature-owned route groups to HTTP adapters.
- `auth_handlers.go`: register, login, bearer identity, password recovery.
- `session_handlers.go`: app sessions, account summary, and devices.
- `rule_handlers.go`: baseline and owner-scoped custom rules.
- `dataset_handlers.go`: protected dataset and compute-grant issuance.
- `screener.go`: socket ticket and one-request WebSocket evaluation.
- `operator_handlers.go`: privileged audited access-management endpoints.
- `subscription_handlers.go`: public plans, owner state/cancel, operator activation.
- `system_handlers.go`: engine/protocol capability reporting.
- `http_helpers.go`: authentication/authorization guards and compatibility
  wrappers; generic JSON, CORS, request IDs live in `platform/http`.

A handler should only:

1. parse and validate HTTP input;
2. call a domain interface;
3. translate domain errors to HTTP errors;
4. write the response.

Indicator formulas, authorization policy, and SQL do not belong in handlers.

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
| Supabase Postgres (`signalgen` schema) | Profiles, roles, account status, manual grants, subscriptions, audit events, app sessions, device state, user rules, compute grants |
| Process memory | One-use screener tickets and rate-limit counters |
| Fixture JSON | Current synthetic OHLCV dataset |
| WebSocket | Transport only; it stores no durable data |

SQLite repositories remain inside selected feature packages for legacy
comparisons and existing unit fixtures. The active Go API never constructs
those repositories, opens a SQLite file, or mounts its former volume.

## Production storage

Supabase Auth owns identity. Supabase Postgres schema `signalgen` owns durable
application data. The schema is not exposed through Supabase Data API; its
tables have RLS and selected owner-read policies as defense in depth. The Go
API verifies identity, session, role, ownership, and entitlement at its own
boundary. The Postgres connection user can bypass RLS, so SQL owner filters
remain mandatory. A future dedicated least-privilege database role should be
tested before production deployment.

Socket tickets and rate limits remain process memory. Multiple API replicas
need shared TTL state before they can serve the same WebSocket ticket flow.
The market-data fixture will later be replaced by an authorized provider.

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
