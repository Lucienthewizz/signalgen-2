# Backend security hardening

## Connection boundaries

The active HTTP API connects as `signalgen_api`, not `postgres`. It refuses to
start with another role or with superuser, BYPASSRLS, role-management,
database-creation, inherited-role or audit-mutation privileges.

The versioned migration creates this role without LOGIN or a password. After
applying migrations, provision a strong password outside Git. With a trusted
Postgres administration connection, enable LOGIN and use psql's `\password
signalgen_api` to avoid putting a plaintext password in SQL/history. Shared
Supabase session-pooler usernames use `signalgen_api.<project-ref>`; retain the
host, port 5432 and TLS configuration copied from the Connect dialog.

- `backend/.env`: `SUPABASE_DB_URL` is the restricted runtime URL. This is the
  **only** database secret passed to the HTTP container.
- `backend/.env.migrations`: local administrative secrets, excluded from Git
  and the Docker build context. `SUPABASE_MIGRATION_DB_URL` is for migration
  commands; `SUPABASE_ADMIN_DB_URL` is for the local admin CLI. Both remain
  outside the HTTP container environment.
- Deployment: use separate secret stores/jobs with equivalent separation.
  Do not copy `.env.migrations` to frontend code or an API container.

For the already-configured developer checkout, future migrations can use:

```sh
set -a
source backend/.env.migrations
set +a
npx --yes supabase@2.81.3 db push --db-url "$SUPABASE_MIGRATION_DB_URL" --dry-run
# Review the listed migrations before applying:
npx --yes supabase@2.81.3 db push --db-url "$SUPABASE_MIGRATION_DB_URL" --yes
```

Do not enable shell tracing (`set -x`) or paste expanded connection URLs.
Keep both environment files readable only by their owner. The runtime role
cannot create/drop application tables, read `auth.users`, access the legacy
archive, modify plan/catalog definitions, delete accounts, bootstrap an
operator, or rewrite/truncate the audit ledger. It may perform the exact
application operations used by owner and operator services.

## What RLS does and does not enforce

The role has NOBYPASSRLS and explicit policies for trusted server operations.
These policies are **not tenant isolation for direct pgx queries**: they allow
the trusted backend to serve different users and authorized operators.
Repositories must still use the verified owner ID, and operator mutations
must still check account status, role and app-session inside the API/use case.
Removing an owner predicate is still a security bug.

Browser `authenticated` policies remain separate and owner-scoped; neither
`anon`, `authenticated` nor the Data API may assume the backend role.
Private `signalgen` and `legacy` schemas are not exposed through the Data API.
Legacy tables intentionally have RLS with no client policies (deny by default).

The existing `public.handle_new_user()` and `public.rls_auto_enable()` helpers
remain attached to their triggers, but client EXECUTE has been revoked.
They were trigger/event-trigger functions, not evidence of a proven RPC exploit.
Signup-trigger invocation after revocation is checked with a local fixture;
no real cloud account is created or deleted by these schema tests.

## Readiness and HTTP contract

`/health` checks process liveness. `/ready` also requires all active tables,
editable-profile columns, RLS, the admin status audit constraint, valid audit
cursor index, enabled immutable-audit trigger and restricted runtime role.
The runtime check also verifies every required table grant, sequence permission
and versioned trusted-backend policy. A missing write permission or a policy
that silently hides rows must not leave the service marked ready. The checks
are read-only; they never repair privileges automatically or grant broader access.
The access manifest lives in `internal/platform/database/runtime_access.go`;
change it alongside a migration if legitimate runtime operations/policies change.
Unexpected restrictive policies affecting the backend or PUBLIC also fail this
check, while client-only policies do not affect runtime readiness.
Failures return 503 with a generic message; database credentials and internal
schema errors are never included in public readiness responses.

`GET /api/openapi.yaml` serves the reviewed document embedded in the API binary.
`GET /api` reads its version from that same document. Unknown endpoints return
404 JSON; unsupported methods on registered Gin routes return 405 JSON with
`Allow`. Both use the shared request ID and `private, no-store` error contract.
The raw WebSocket upgrade boundary remains unchanged.

## Verification and remaining deployment work

CI runs isolated schema/ownership/runtime-privilege checks, real Model A WASM
integration, race tests, static analysis, pinned govulncheck and OpenAPI
validation. The application integration tests use `SET SESSION AUTHORIZATION signalgen_api` for
all repositories, while fixture/DDL operations use a separate test admin pool.
Tests that change schema use rolled-back local transactions and refuse cloud
hosts or databases other than `signalgen_test`.
Runtime-access regressions additionally revoke grants or remove/change policies
inside those transactions, and verify that the readiness check rejects them.

Govulncheck's called/imported-package findings are distinct from advisory
findings on unused transitive modules. A passing scan does not prove that every
unused dependency, base image or deployment setting is vulnerability-free.

Leaked-password protection is a separate Supabase Auth setting and requires
Pro or above. Enable it under Authentication settings if the project supports
it; do not silently upgrade the billing plan. Also validate real-user
login/recovery/signup after deployment, TLS/proxy configuration, production
load and market-data/provider rights before claiming production readiness.

References: [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles),
[connection usernames](https://supabase.com/docs/guides/database/connecting-to-postgres),
[safe password provisioning](https://www.postgresql.org/docs/17/sql-createrole.html),
[password security](https://supabase.com/docs/guides/auth/password-security).
