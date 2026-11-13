# Scheduled incremental IDX history

`collectidx -incremental` maintains a rolling history store independently of
browser sessions. The default backfill is five years; subsequent publications
reuse the previous history and request only new dates plus seven calendar days
of overlap. Provider rows in the overlap replace earlier rows, including
corrections. Older corrections require a rebuild into a separate output store.

## Run and serve

```sh
cd backend
go run ./cmd/collectidx -catalog /path/idx-catalog.csv \
  -out /private/path/idx-store -incremental -years 5 -overlap-days 7
```

The catalog is an operator-supplied IDX export; refresh it when listings change.
The existing conservative 18:00 WIB cutoff excludes the in-progress local day.
It is not an exchange-calendar certification. Short listings retain their actual
history; the collector does not fabricate five years of prices.

Each target catalog/window has a resumable generation with its own report and
checksummed snapshots. Failed/pending rows remain visible and are retried on
the next invocation. A process lock prevents overlapping collectors. A failed,
canceled or incomplete generation does not replace `current.json`. A complete
generation is published atomically. Repeating a published window performs no
provider requests. Existing fixed-window collector mode remains available.

Set the API's deployment environment to:

```text
SIGNALGEN_MARKET_DATA_MODE=idx_store
SIGNALGEN_IDX_HISTORY_DIR=/private/path/idx-store
```

The first complete publication must exist before starting this mode. Mount the
store read-only in the API, with permissions matching its unprivileged user.
The adapter resolves the current immutable generation per request, supports
latest candles and historical ranges, and never falls back to live Yahoo.
For `idx_store`, each shared-cache request pins an immutable generation and uses
its revision in latest/history keys. A newly published generation is visible to
subsequent requests without waiting for the TTL; in-flight reads and existing
dataset handles retain their original data. Separate history calls select their
generations independently. Providers without this snapshot capability retain
their existing TTL behavior. Snapshot available dates and quality warnings remain
visible. An unavailable range
is an explicit error; missing future candles remain unavailable for evaluation.

## Server timer

The runtime image now includes `/usr/local/bin/signalgen-collect-idx`.
Sample Linux units are in `deploy/systemd/signalgen-idx-sync.service` and
`deploy/systemd/signalgen-idx-sync.timer`. They run at boot and hourly at minute
30 in Asia/Jakarta, permitting retries without waiting for a browser. The
collector itself prevents repeated downloads of a completed daily window.

For a Linux host deployment, build/install the collector binary, ensure the
`signalgen` user/group exists, and place a readable catalog at
`/etc/signalgen/idx-catalog.csv`. Review the paths in the service before installing
both units into `/etc/systemd/system/`, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now signalgen-idx-sync.timer
systemctl list-timers signalgen-idx-sync.timer
journalctl -u signalgen-idx-sync.service
```

These files have not been installed or enabled on a server by this change.
Systemd is not available on macOS. Timer timezone syntax follows the
[systemd time specification](https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html).

## Operations and limits

The store is private plaintext research data with restrictive file permissions;
do not serve it through public/static hosting. Failed generations contain reports
for inspection and resume. If a hard-killed process leaves a lock, confirm that
no collector owns the store before removing that lock. No automatic lock stealing
is implemented.

Generations retain full local snapshots for coherent reads and rollback. Network
fetches are incremental; disk snapshots are not append-only. After a successful
incremental run, retention keeps the current publication and at least two valid
retired generations by default. An older generation is eligible only after
72 hours since it left the current publication. Creation time does not start the
grace period. Keep/grace options cannot be reduced below two generations total
and 24 hours. API requests must finish within that retirement grace period.

`retired.json` records retirement times before each publication switch. The
collector's existing lock also serializes cleanup. The current publication is
validated before any removal; corrupt current data preserves rollback archives.
Cleanup validates candidate snapshots and removes only known regular files using
directory-scoped filesystem handles. Partial generations, symlinks, active locks,
unexpected files and invalid archives are skipped. Untracked generations from
older installations remain untouched. These skipped/untracked folders still
require operator review and disk monitoring.

Review eligible generations without downloading data or deleting files:

```sh
signalgen-collect-idx -out /private/path/idx-store -prune-only -retention-dry-run
```

Apply the same retention policy:

```sh
signalgen-collect-idx -out /private/path/idx-store -prune-only
```

Use `-keep-generations` and `-retirement-grace` to retain more archives or a longer
grace period. `-retention-dry-run` can also accompany `-incremental`; it affects
cleanup only, while data acquisition and publication still run normally. A
filesystem failure or interruption during cleanup may leave an unreferenced
partially removed generation for manual review; the current archive stays intact.

One unavailable ticker prevents publication of a new complete catalog. The API
keeps serving the previous complete generation; inspect per-ticker reports and
freshness instead of interpreting a stopped publication as fresh market data.
Yahoo coverage, corporate-action handling and exchange-calendar completeness
remain provider-quality limitations. This does not introduce SQLite, premium
data, a historical point-in-time listing universe or measured production capacity.

## Verification

On 12 November 2026, these checks passed using existing local dependencies in a
Linux container with no external network, an empty allowlisted environment,
read-only source/toolchain, scratch-only writes, and bounded resources:

```sh
go test ./internal/collection ./cmd/collectidx ./cmd/api -count=1
go vet ./internal/collection ./cmd/collectidx ./cmd/api
```

Synthetic-provider tests exercise five-year backfill, the smaller incremental
fetch window, correction replacement without duplicate dates, rolling-window
preservation, repeated-run idempotency, publication changes visible to an existing
provider, incomplete-run retry, cancellation, lock rejection, corrupt snapshots
and invalid publication paths. Existing collection/archive and cutoff tests also
passed. Timer activation on Linux, a new Docker image build, live Yahoo acquisition
and full-market data completeness have not been verified in this change.

Retention follow-up verification passed the same test/vet commands in the
isolated container. Seven retention tests cover dry-run versus deletion,
preserving current/rollback generations, retirement-based grace, unknown files,
symlinks, incomplete data, active locks, invalid policy/index paths, cancellation,
corrupt current snapshots and selection of the newest valid rollback. The CLI
help output also lists the new retention options. No cleanup was applied to an
operator's actual market-data store during these checks.
