# Disposable local API-stack verification

This opt-in check runs the actual packaged `cmd/api` process with real HTTP
routes, private scoring, app-session guards and restricted-role PostgreSQL
repositories. Only the identity provider, market histories and disposable
subscription/account fixtures are synthetic. It does not contact Supabase or
Yahoo, start production services, or reuse an existing database.

Run from the repository root with Docker's local `orbstack` context available:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/test_local_api_stack.py
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/verify_local_api_stack.py
```

The runner requires the three exact locally cached image IDs recorded in its
source. It never pulls images or downloads Go modules. A five-second Docker
server preflight fails before setup if the control plane is unresponsive. The
previous transient timeout is preserved in
[the blocked snapshot](../evidence/local-api-stack-blocked-20261113.md).

## Boundaries

| Component | Execution |
| --- | --- |
| Application API | Existing verified local image `sha256:cf5e1397b73b4e463b360897f19f5ac0fe02470288b025dd1114a614efa85a50`; actual `/usr/local/bin/signalgen-api` process, no handler substitution |
| PostgreSQL | Fresh private tmpfs cluster and database named exactly `signalgen_test`; current migrations and three policy checks via existing `cmd/schematest` |
| API database role | `signalgen_api`, LOGIN only in this disposable cluster, with existing non-superuser/no-bypass-RLS privileges and actual runtime readiness checks |
| Bootstrap client | Separate one-shot helper uses the disposable cluster's administrator to create only test identities (owner A as disposable operator), server-owned Pro subscriptions and 23 catalog rows |
| Identity upstream | Local HTTP fixture implements password login and authoritative HS256-token user lookup for two `@test.invalid` identities; production verification code is unchanged |
| Market provider | Generated rising/falling OHLCV fixtures, published by real `collection.Sync`; API consumes the resulting `idx_store` through a read-only bind |
| Feature/outcome client | Native portable Go core in the isolated client; no mocked private-decision output and no browser/WASM claim |

The initial `none` network namespace belongs to this task's private PostgreSQL
container. Other task containers share only that namespace and communicate over
127.0.0.1; no host ports are published. Each target has a read-only root, dropped
capabilities, no-new-privileges, two CPUs, 1 GiB RAM (2 GiB for compilation), 128
PIDs, 1024 open files, 128 MiB file-size limit and a bounded scratch tmpfs. The
compiler gets 2 GiB scratch; PostgreSQL gets 512 MiB; API/identity get 256 MiB;
verification gets 64 MiB. Container log persistence is disabled. No Docker socket,
host home, personal env, credentials or shared service is mounted.

Compilation runs under an empty allowlist with scratch HOME/temp/cache,
read-only source/module cache, dependency lookup disabled and a 360-second
inner deadline. API and fixture helpers have a 240-second deadline; PostgreSQL
has 480 seconds. Parent calls enforce bounded time and output. Stock image
entrypoints are overridden by explicit reviewed commands. API configuration is
an explicit dummy allowlist supplied to the child process, not inherited from
the host. Only the five previously packaged application binaries are reused;
test helpers and `schematest` are compiled in the offline container.

Source for protected application/schema inputs must match base
`25ea6006daff8ac2a70f2481f4f0e37fa06b9038`. That commit changes only documentation
relative to packaged source `2c4ad1dfbb6a045b7d5a6968eacf971b6f3b81e2`.
The runner rejects dirty protected inputs and copies only tracked allowlisted
paths plus the explicit test helper files. It validates bounded regular named
artifacts before placing them in its private scratch tree.

## Coverage and limits

The HTTP journey covers actual login/bearer and app sessions, owned rule/universe
creation, 23 stocks across three historical batches, real matched/unmatched
private decisions and native outcome handoff. It checks frozen rule/date/source
metadata and grants, foreign-owner refusals, expiry, active-context refusal,
batch release, cancel/recreate and stale handles. Rule edits after context
creation must stop preparation with `VERSION_MISMATCH`.

The browser phase still needs validation. This host's ordinary browser process
cannot enforce the required isolated loopback namespace and full resource/write
controls. No approved cached browser image is provided by this task, and it
installs none. A safe follow-up needs an existing reviewed browser/runtime image
with the same limits, sharing only the private namespace, plus read-only local
app/WASM assets and private IndexedDB/profile scratch. Do not publish stack ports
or use a personal profile to work around the missing control.

Passing this harness establishes the local packaged API boundary with fixture
identity/data. It does not establish real Supabase integration, browser-to-real-API
operation, WebSocket/latest-price operation, real IDX freshness, premium provider
support or production capacity. Earlier six browser suites remain API-mocked
synthetic evidence. Full production `Go.Dockerfile` clean-build verification is
also separate from this local package.

Cleanup removes only exact randomly named task containers in reverse order;
it never prunes Docker, modifies a prior image, or touches other worktrees.
Private temporary build/fixture output stays outside Git and can be removed
by its exact printed scratch path after review. See the dedicated evidence
[record](../evidence/local-api-stack-20261113.md) for the actual result and image/helper hashes.

The composition and guard paths are source-backed:
[API composition](../../backend/cmd/api/main.go),
[Supabase identity bridge](../../backend/internal/auth/supabase.go),
[runtime role readiness](../../backend/internal/platform/database/postgres.go),
[study contexts and batches](../../backend/internal/api/backtests/studies.go),
[private signal service](../../backend/internal/backtest/signals.go) and
[immutable store publication](../../backend/internal/collection/sync.go).
The existing [Postgres handler integration test](../../backend/internal/api/tests/postgres_integration_test.go)
uses injected identity/handler composition; this new harness verifies the packaged
process instead. Neither check establishes live Supabase identity behavior.
