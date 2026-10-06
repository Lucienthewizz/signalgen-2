# SignalGen database schemas

SignalGen uses explicit PostgreSQL schema boundaries:

| Schema | Owner and purpose | Client access |
|---|---|---|
| `auth` | Supabase Auth identities, passwords, and provider state | Managed by Supabase Auth |
| `signalgen` | Active multi-user application data | Through the Go API |
| `legacy` | Lossless archive of the former SQLite databases | No browser access |
| `public` | No SignalGen application tables | Not used for application state |

`signalgen` and `legacy` must not be added to the Supabase Data API exposed
schemas without an explicit architecture and security review. PostgreSQL
grants and RLS policies are separate from Data API exposure: grants decide
which operations a role may attempt, while policies restrict the rows visible
to that role.

Selected owner-scoped grants and policies remain on `signalgen` as a tested
defense-in-depth contract. They do not replace authorization in the Go API.
Every backend repository query must still filter by the verified owner and
the API must enforce session, account status, role, and entitlement rules.

## Change rules

1. Create schema changes as versioned files under `supabase/migrations`.
2. Put active application tables in `signalgen`, not `public`.
3. Never add custom objects to Supabase-managed schemas such as `auth`,
   `storage`, or `realtime`.
4. Keep `legacy` read-only and unavailable to `anon` and `authenticated`.
5. Enable RLS on every application table, including backend-only tables.
6. Test API ownership and database policy behavior with two different users.
7. Run the automated schema test after changing migrations or policies.

## Automated local check

The runner applies every migration to a fresh local database, then verifies
schema boundaries and two-user RLS ownership:

```sh
cd backend
SIGNALGEN_TEST_PG_URL='postgres://postgres:password@127.0.0.1:5432/signalgen_test?sslmode=disable' \
  go run ./cmd/schematest -repo-root ..
```

For safety, the runner only accepts a loopback PostgreSQL host, requires the
database name `signalgen_test`, and refuses a database that already contains
`auth`, `signalgen`, or `legacy`. It never needs Supabase production secrets.
The same runner executes in `.github/workflows/backend.yml` before the backend
test suite.

The frontend may use Supabase Auth for identity flows. It must not query
SignalGen application tables with `.from(...)`, `.schema("signalgen")`, or the
`/rest/v1` Data API; it calls the versioned Go API instead.
