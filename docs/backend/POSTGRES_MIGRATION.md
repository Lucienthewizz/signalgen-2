# Web multi-user Postgres migration

Status: the `web_multi_user`, `compute_grant_session_index`, and
`legacy_sqlite_archive` migrations were applied to the SignalGen Supabase
project on 29 September 2026. Their remote versions are `20260929041140`,
`20260929075259`, and `20260929082359`, matching the files under
`supabase/migrations`. The active Go API now connects through
`SUPABASE_DB_URL`; it does not open SQLite.

Update 6 October 2026: the subscription, stock-universe, editable-profile,
operator-status and backend-runtime-privileges migrations are also applied.
All eight migration versions match the local files. HTTP runtime now uses
`signalgen_api`; migration/admin credentials are separate. See
[`SECURITY_HARDENING.md`](SECURITY_HARDENING.md) for the current setup.

## Ownership

- Supabase Auth keeps passwords and user identities (`auth.users`).
- `signalgen.account_profiles` keeps application role and status.
- `signalgen.feature_grants` keeps time-bound feature access.
- `signalgen.app_sessions` and `account_device_state` keep device/session state.
- `signalgen.user_rules` keeps owner-scoped rule snapshots.
- `signalgen.compute_grants` binds a user, session, dataset, rule, and version.
- `signalgen.audit_events` is append-only; `operator_bootstrap_state` records
  the one-time first-operator setup.

Every application table has RLS enabled. The `signalgen` schema is not exposed
by the Supabase Data API, and the browser must use the Go API rather than call
`.schema("signalgen")` directly. PostgreSQL grants do not expose a custom schema
to the Data API on their own. The selected grants and policies keep the
owner-scoped RLS contract testable as defense in depth: if direct access is
approved later, authenticated users can read only their own profile/grants and
CRUD only their own rules. Session tokens, operator state, and audit events
have no direct client policies. The Go API uses its verified principal for
every owner filter and checks role/entitlement before serving private
requests. The restricted trusted-server role has explicit operation policies;
these are not tenant filters, so verified-owner API checks remain essential.

Schema boundaries are verified by `supabase/tests/schema_boundaries.sql`.
Active application tables belong in `signalgen`; the `legacy` schema remains a
client-inaccessible archive; SignalGen application tables must not be added to
`public`.

## Development

1. Copy `backend/.env.example` to `backend/.env` and fill in the Supabase
   project URL, publishable key, and Session Pooler connection string. Keep
   `.env` out of Git. The password in a URL must be percent-encoded.
2. Apply migrations from `supabase/migrations` to a fresh project before
   starting the API, then provision the restricted runtime role. Use a separate
   migration secret, never the runtime URL, for migration commands. For the
   connected SignalGen project, the current eight migrations are already
   recorded remotely; do not apply them a second time.
3. Run `docker compose up --build go-api` and check `GET /health` and
   `GET /ready` at port 8080.
4. Run `cd backend && go test ./...`. The opt-in connection check uses
   `SIGNALGEN_RUN_POSTGRES_CONNECTION=1 go test ./internal/platform/database -run
   '^TestPostgresConnection$'` with `SUPABASE_DB_URL` loaded in the process
   environment. It checks only metadata and does not print the URL.
5. The isolated API integration test uses `postgres:16`,
   `supabase/tests/local_auth_stub.sql`, and all migration files. Set
   `SIGNALGEN_TEST_PG_URL` to a dedicated loopback PostgreSQL database named
   `signalgen_test` before running
   `go test ./internal/api/tests -run '^TestPostgresAPIContractsAndOwnership$'`.
   The test refuses other hosts/database names and clears only that dedicated
   test database.

The SQL ownership test in `supabase/tests/ownership.sql` runs in a transaction
that rolls back. It needs two existing Auth users and checks that a second user
cannot read, update, or delete the first user's rule. It was executed against
the connected Supabase project with zero leftover test rows.

## Deployment limitations

The former SQLite databases are preserved. Their rows were archived, not
activated, in the private `legacy` schema of the connected Supabase project:

- `local_backend_sqlite_20260908`: 10 tables, 3,062 rows, including 3,030
  historical candles, 4 system rules, and 1 ownerless watchlist.
- `docker_backend_volume`: 11 tables, 23 rows. This is an older snapshot.

The former Go SQLite volume had zero application rows and was not archived.
The archive has 2 source records, 21 table definitions, and 3,085 row records.
Run `select source_label, table_count, row_count from legacy.sqlite_sources;`
in the Supabase SQL Editor to inspect it. The archive is not exposed through
the Data API and does not populate the active `signalgen` tables. In
particular, old desktop rules and watchlists have no user owner; assigning
them to a web account requires an explicit product decision. Historical
candles may also be stale and are not the current screener dataset.

To archive another consistent SQLite snapshot, from `backend/` run
`go run ./cmd/importlegacy --sqlite /absolute/path/to/snapshot.db --label
descriptive_name` first for a read-only dry run, then repeat with
`--env-file /absolute/path/to/legacy-admin.env --expected-project-ref <project-ref>
--apply`. That separate administrative environment must define the importer's
`SUPABASE_DB_URL`; the restricted runtime URL cannot write the archive. If
runtime `SUPABASE_DB_URL` is already exported, unset it only for that command
with `env -u SUPABASE_DB_URL go run ...` so the importer reads the intended file. The importer
checks SQLite integrity and uses the file SHA-256 to avoid duplicate imports.
Keep the original SQLite files and volumes until retention is decided. App
sessions require a fresh login after the runtime migration.

The Go API uses the restricted runtime connection from `SUPABASE_DB_URL`;
the admin CLI prefers `SUPABASE_ADMIN_DB_URL` outside the API container.
Before production deployment, rehearse backup/restore and decide how to share
short-lived WebSocket tickets/rate limits across multiple API replicas.
