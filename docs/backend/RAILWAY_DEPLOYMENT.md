# Railway deployment and daily archive

This deployment keeps Model A unchanged: Go/WASM calculates indicators in the
browser; Go/Gin checks account access and evaluates rules. Redis caches public
OHLCV. Supabase PostgreSQL stores a rolling three-calendar-month daily archive
for IDX and US. Intraday still uses Yahoo. Local five-year files are preserved.

Deployment completion is recorded in [the evidence report](../evidence/railway-deployment-20261119.md).
Configuration files and passing fixtures alone do not prove a live deployment.

## Branches and free-plan limits

- Checkpoint: `checkpoint/backend-before-railway-20261119`, at
  `a65206369f469fa607dc8aa38e20320b6ca83569`.
- Implementation: `feature/backend-railway-deploy`.
- Separate workflow-only PR against `main`; do not merge the backend to main.
- Railway Free only: one API replica and one private Redis service. Do not
  enable a paid plan, autoscaling, or public Redis access. Credits and sleeping
  mean availability is not guaranteed 24 hours a day.

## 1. Database and writer enrollment

Apply the new migrations after verifying the target project and a local schema
test. They add six `signalgen.market_*` tables without changing user data.
`signalgen_api` reads production rows only. `signalgen_market_writer` writes
market tables and reads the catalog; it has no access to user profiles, rules,
sessions, payments, journals or Auth users.

The enrollment migration is opt-in: ordinary migration runs leave the new
writer NOLOGIN. To prepare a new random writer credential outside the repo:

```sh
python3 backend/scripts/prepare_market_writer.py \
  --env backend/.env --output /private/tmp/signalgen-writer-enrollment
```

The private directory contains `writer-url` and `enroll.sql` with mode 0600.
The latter contains a salted SCRAM verifier, never the clear password. Apply
that transaction-local setting followed by the enrollment migration through
the project administrator connection. Never commit either generated file.
Do not rerun enrollment to rotate a working credential without updating its
users. The script refuses to overwrite existing files.

Store `writer-url` directly as GitHub Secret `SIGNALGEN_MARKET_WRITER_URL`.
Use a direct or **session pooler** connection, not the transaction pooler:
the collector holds session-level advisory locks. The API never receives this
secret. Four writer connections allow the global smoke lock, market lock, and
transaction to coexist. CLI startup verifies the role and private-data denial.

## 2. Archive collection and capacity

From `backend/`, with the writer URL loaded privately into the process:

```sh
go run ./cmd/syncmarket -check
go run ./cmd/syncmarket -scope production -market IDX -event manual \
  -external-id bootstrap-idx-20261119 \
  -bootstrap-idx-dir /absolute/path/to/validated/idx/store \
  -report /private/tmp/idx-bootstrap.json
go run ./cmd/syncmarket -scope production -market US -event manual \
  -external-id bootstrap-us-20261119 -report /private/tmp/us-bootstrap.json
```

No CLI argument contains a credential. Catalog contents and exchange-local
calendar bounds are frozen at run start. Provider validation excludes unfinished
candles. Collection is serial with at least one-second spacing, at most two
attempts per ticker, and `Retry-After` respected. Each run has a 270-minute
deadline. The normal update fetches a seven-calendar-day correction overlap.
Local IDX bootstrap is read-only; Yahoo must refresh the recent overlap before
an imported ticker is considered updated. US gaps are fetched from Yahoo.

Before a market's initial import, three measured histories estimate all still
missing catalog instruments. The estimate includes staging, row/index headroom,
and every weekday in the frozen window, so an IPO cannot make it artificially
small. The estimate and current bytes are stored on the run. Abort at a projected
350 MiB; staging/publication reserve space before the hard 400 MiB guard. Both
markets serialize capacity checks through a shared database lock. These are
conservative estimates, not a PostgreSQL storage-size guarantee. Actual total
`pg_database_size` must be checked after each bootstrap before activation.

Each ticker has success/failure, attempts, quality metadata, and counts. Partial
coverage is explicit. A revision publishes atomically; only new/changed OHLCV
creates rows. Retired versions survive for 72 hours, and datasets/cache requests
pin the publication revision. Smoke uses a separate scope inaccessible to the
API. Failed refreshes retain old candles with a warning rather than becoming a
fresh successful result. Short history and missing archive are distinct from
valid `No match`.

An interrupted run preserves staged results and status for inspection. A new
run uses a new external ID; it does not silently label a cancelled run complete.
Completed external IDs are idempotent. Reusing an ID with different dates or a
changed catalog is rejected. Do not run thousands of per-user downloads.

## 3. Railway API and Redis

1. Log in with the Railway CLI and confirm a Free workspace/project. Create two
   services, `api` and `market-cache`, with the **monorepo root** as build root.
2. API config path: `/railway.toml`; Dockerfile: `backend/Go.Dockerfile`.
   Its final/default `railway-runtime` stage builds native binaries. Explicit
   `wasm-artifact` exports remain available for the frontend separately.
3. Redis config path: `/railway.redis.toml`; Dockerfile:
   `backend/Redis.Dockerfile`. It pins the same Redis image digest as local.
   Set `REDIS_PASSWORD` to a new random alphanumeric secret of at least 32
   characters. The entrypoint enforces 64 MiB, `allkeys-lru`, no persistence,
   protected mode and authentication. Do not create a TCP/public domain.
4. Set API variables from `backend/deploy/railway-api.env.example`, copying the
   restricted API connection and Supabase Auth settings privately. Reference
   Redis through Railway's private domain and password reference. Do not copy
   the writer/admin connection into the API service.
5. One API replica is mandatory while socket tickets and dataset handles are
   process-local. `SIGNALGEN_GO_API_ADDR` overrides `PORT`; if neither is set,
   8080 is used. Leave the explicit address unset in Railway. Health probes use
   the same listener. `/health` is liveness; `/ready` checks actual dependencies
   and archive read privileges, not Redis availability or complete coverage.
6. Publish only the API's HTTPS domain. Verify `/health`, `/ready`, login and WSS.
   Origin allowlist must include **both** `http://localhost:5174` and
   `http://127.0.0.1:5174`; no wildcard. Auth redirects still point to the local
   frontend. Leave payment sandbox enabled.
7. For local frontend testing, restart Vite on 5174 with
   `VITE_API_ORIGIN=https://YOUR-API-DOMAIN`. This makes HTTP use HTTPS and socket
   URLs use WSS directly. Do not accidentally keep a local proxy as cloud proof.
   Changing the API origin can require a fresh login; never share tokens.

Redis failure keeps RAM/provider fallback. An archive daily request still
requires the database; a cache outage does not replace missing archive data
with an apparently valid result. Check database, Redis, and request logs without
printing connection strings. Free-plan credit exhaustion must be reported.

## 4. Five-minute scheduler proof

The workflow must be merged through its **workflow-only PR** to the default
branch and enabled for this public fork. A file on a feature branch cannot
prove automatic scheduling. Do not merge the backend merely to activate cron.

Repository variables:

| Variable | Value |
|---|---|
| `SIGNALGEN_DEPLOY_REF` | Full reviewed deployment commit SHA |
| `SIGNALGEN_SMOKE_ENABLED` | `true` only during the bounded test |
| `SIGNALGEN_SMOKE_ID` | UUID returned by `syncmarket -arm-smoke` |
| `SIGNALGEN_SMOKE_ARMED_AT` | UTC arm timestamp (expiry minus one hour) |
| `SIGNALGEN_DAILY_ARCHIVE_ENABLED` | `false` until review passes |

Arm **after** workflow review, bootstrap and deployment preflight, using the
pinned SHA and the same restricted writer connection:

```sh
go run ./cmd/syncmarket -arm-smoke -deployment-ref FULL_40_CHARACTER_SHA \
  -report /private/tmp/scheduler-arm.json
```

First dispatch a manual run of `market-archive-smoke.yml`. It must fetch and
write BBCA.JK/BBRI.JK/TLKM.JK and AAPL/MSFT/NVDA through the production collector.
It does not count toward the automatic success total. Wait for **three distinct
GitHub runs whose event is `schedule`**. Review their run IDs, start/end times,
market coverage and new/changed/unchanged counts. Unchanged data is valid.

Database event IDs prevent double-counting retries. Both three-stock markets
must be complete for an automatic event to count. Database and workflow guards
limit the test to six scheduled attempts and one hour; late starts cannot
extend the collection deadline. The workflow self-disables when passed,
exhausted or expired. Only this test has `actions:write`; production has
`contents:read`. The outer GitHub-run guard also stops collection when the
database is unavailable. Verify the workflow's disabled state afterward.

GitHub may delay or drop scheduled runs. Fewer than three actual schedule
events means **not yet proven**. A manual dispatch, DB fixture, or log heartbeat
cannot substitute. Do not leave the five-minute test armed overnight.

## 5. Activate the normal schedule and rollback

Only after checking bootstrap coverage/size, three automatic successes, real
account HTTPS/WSS screening, and disabled smoke workflow, set
`SIGNALGEN_DAILY_ARCHIVE_ENABLED=true`. Production schedules (UTC):

- IDX `17 12 * * 1-5`: 20:17 WITA / 19:17 WIB.
- US `37 2 * * 2-6`: 10:37 WITA, after the previous US session, including DST.

The workflow checks out the pinned deployment ref, not whatever code happens
to be on main. Workflow concurrency and database market locks both prevent
overlap. Inspect each market's latest publication and full/partial report.

Rollback: disable daily and smoke workflows first. Restore the API deployment
and its compatible provider mode; `yahoo` works without a local archive mount.
Remove/empty `SIGNALGEN_REDIS_URL` to bypass Redis. Local `idx_store` is usable
only where the preserved read-only directory is mounted. Keep the additive
tables, old revisions and local archives; no rollback drops user/market data.
Revoke the writer login only after all collector jobs are stopped.

References: [Railway Free](https://docs.railway.com/pricing/free-plan),
[Railway config](https://docs.railway.com/guides/config-as-code),
[GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
