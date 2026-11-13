# Opt-in local IDX scheduler

The collector can run independently of website Start with `-schedule
-incremental`. It runs immediately, then waits after each completed execution.
The default success delay is 24 hours; failures retry after one hour. There is
one active run, no catch-up queue and a two-hour timeout per run.

Each execution rereads the operator's catalog, recomputes the completed-day
boundary in Asia/Jakarta and requests the rolling five-year window. Before
18:00 WIB the current date is excluded; at or after 18:00 the next date becomes
the exclusive end. This is a conservative wall-clock cutoff, not an exchange
calendar or proof that every provider row is final.

The scheduler reuses existing `Sync`: seven-day incremental correction overlap,
immutable generations, same-catalog/same-window idempotency and retention only
after successful publication. A failed/partial run keeps the previous published
generation. A visible catalog-content update is picked up on a later run. Same-day unchanged
input does not redownload provider history; corrections are refreshed when the
next generation is collected.

## Explicit local Docker setup

Use the verified image from this branch's evidence, a private existing output
store writable by container UID/GID 10001 and an operator-supplied catalog file.
The scheduler does not fetch the catalog or treat a bundled list as complete.
Set these variables in a clean operator shell; never copy personal environment
files into the image or repository:

```sh
export SIGNALGEN_LOCAL_IMAGE='sha256:6341966d32f78ce0adcdb235138a5fce45552bdeb8a9c05c3a0db9493832439b'
export SIGNALGEN_LOCAL_IDX_STORE=/absolute/private/idx-store
export SIGNALGEN_LOCAL_IDX_CATALOG=/absolute/operator/catalog.csv
export SIGNALGEN_LOCAL_API_ENV_FILE=/absolute/explicit/api-env-file

docker --context orbstack compose --env-file /dev/null \
  -f docker-compose.local-runtime.yml --profile idx-scheduler \
  up -d idx-scheduler
```

This is an opt-in live operator command, **not a command run during validation**.
It can contact Yahoo over the service's Docker network and write the private
store. Confirm data-source rights/rate limits and provision disk space and UID
permissions before starting it. The existing collector profile remains a
network-none, validate-only one-shot; ordinary compose use does not enable the
scheduler profile. This profile binds a single catalog file: in-place updates
are visible, but replacing the host file by rename can leave the old inode
mounted. Restart this service after an atomic catalog replacement; catalog
auto-download/rediscovery is not included. The API keeps its read-only published-store mount. API env
configuration is still explicit because the standalone compose file also defines
the API; no authenticated API is needed to run this collector job.

The scheduler service has `restart: unless-stopped`, a read-only root, non-root
UID/GID 10001, a read-only catalog bind, a separate writable store bind, dropped
capabilities and CPU/RAM/PID/file limits. Its inherited API healthcheck is disabled
because it starts no HTTP service. Mounts must exist; Docker does not create an
accidental directory for a missing catalog. Output should use an operator-owned
private volume with a suitable filesystem quota; retention is not a disk quota.

To stop it:

```sh
docker --context orbstack compose --env-file /dev/null \
  -f docker-compose.local-runtime.yml stop idx-scheduler
```

SIGINT/SIGTERM
cancel the current provider/pacing operation, release existing collection locks
and stop the loop. No systemd unit or host scheduler is installed or activated.

## Flags and timing

| Flag | Default and constraint |
| --- | --- |
| `-schedule` | Off; opt-in continuous collection |
| `-incremental` | Required with schedule |
| `-schedule-every` | `24h`, range `1m..168h`, counted after successful completion |
| `-schedule-retry` | `1h`, range `1m..24h`, counted after failure |
| `-run-timeout` | `2h`, range `1m..6h` in the CLI |
| `-delay` | Existing `1s` between instruments, range `500ms..1m` |
| `-years`, `-overlap-days` | Scheduled mode requires 5 years and 7 days |
| `-keep-generations`, `-retirement-grace` | Existing defaults 3 and 72h; minimum 2 and 24h |

Scheduled mode rejects fixed `-as-of`/`-from`, nonzero `-limit`, validate/prune-only
and refresh/retry-failed flags. It retries failures automatically through Sync.
Timing flags without `-schedule` are rejected rather than silently ignored.
Manual one-shot, validate-only, incremental and prune behavior otherwise remains
unchanged. An execution taking an hour shifts the next success check by that
hour; this is fixed-delay scheduling, not a promise of an exact daily wall time.
Restarting the container begins another immediate check; existing publication
idempotency prevents a same-window redownload.

## Verification boundary

Deterministic clock/provider tests cover automatic later runs, boundary advance,
catalog reread, same-day idempotency, old-publication retention on failure,
retry cadence, serial slow operations, timeout/cancel and lock cleanup. The
opt-in `TestSchedulerAutonomousTimerSmoke` uses the production scheduling
function with a real one-minute timer and synthetic history in a bounded,
network-none container; it starts no website or API and has no release CLI fake
provider switch.

See [source scheduler](../../backend/internal/collection/scheduler.go),
[CLI dispatch](../../backend/cmd/collectidx/main.go),
[Compose profile](../../docker-compose.local-runtime.yml) and the dedicated
[evidence](../evidence/local-idx-scheduler-20261113.md) for commands and actual
results. Existing shared cache freshness is a separate concern: this branch does
not change provider/cache generation keys or promise immediate API visibility of
a newly published archive. No real catalog acquisition, Yahoo/IDX coverage,
production uptime, host schedule activation or 1000-user capacity follows from
the synthetic checks.
