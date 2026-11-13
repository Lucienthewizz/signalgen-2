# Local IDX scheduler verification

The opt-in collector scheduler is verified on `frontend/local-idx-scheduler`,
based on `4b2173c4199345770d58cbdcf927bfd3f193fada`. Runtime source is
`304e0b4675313b3599f40ad502140493f0cb16ee`; the delivery child commit adds
only this guide/evidence. [Structured results](local-idx-scheduler-20261113.json)
record source/image hashes, commands and limits.

## Implemented behavior

`-schedule -incremental` starts independently of the website, runs immediately,
then waits 24 hours after success or one hour after failure by default. Each run
rereads the catalog and recalculates the completed-day boundary and rolling
five-year window. It reuses Sync's seven-day overlap, immutable publication,
same-window idempotency and retention. A serial loop prevents overlaps and
catch-up queues. Run deadlines and signal cancellation bound work and clean up
existing collection locks.

The local Compose `idx-scheduler` profile is opt-in, non-root, restartable and
shell-free. It binds catalog read-only and private output writable; the API's
store remains read-only. The inherited API healthcheck is disabled for this
non-HTTP job. Existing one-shot/validate-only/prune defaults are preserved.
No runtime helper, cache, provider, Sync, core, API, dataset, frontend or prior
report was modified.

See the [operator guide](../backend/LOCAL_IDX_SCHEDULER.md) for live-command
prerequisites, timing bounds, fixed-date flag refusals and catalog bind behavior.
The profile may contact Yahoo only when an operator explicitly starts it. It was
never activated for live data during this task.

## Acceptance

| Check | Actual result |
| --- | --- |
| `go test ./internal/collection ./cmd/collectidx -count=1` | Pass on the exact final runtime source, including existing collection/CLI/retention tests |
| `go test -race ./internal/collection ./cmd/collectidx -count=1` | Pass on the same source |
| `go vet ./internal/collection ./cmd/collectidx` | Pass |
| gofmt check | Pass for the collector and scheduler source/tests |
| Deterministic clock/provider tests | Initial/later runs, cutoff advance, rolling window, in-place catalog refresh, same-day no redownload, failed publication preservation, delayed retry, serial slow operations, timeout/cancel, lock cleanup and invalid configuration/flags pass |
| New local image package | Five fresh binaries rebuilt and checked against packaged digests, root ownership and mode 0555; runtime UID/GID 10001 |
| Existing image collector smoke | Help, synthetic validate-only, incremental publications, read-only store and prune dry-run pass |
| Entire collection suite inside the new image | Pass with a matching static test binary and actual packaged collector |
| Production scheduler real-timer smoke | Two autonomous iterations with a real one-minute wait; test duration 60.01 seconds; one synthetic provider fetch, no website/API/Yahoo |
| Packaged CLI | Eight help/default-validation/contradictory-flag cases pass; no valid live scheduled job was started |
| Compose rendering | Empty interpolation/service envfile and synthetic paths; scheduler absent by default and present under its profile; non-root, restart, direct executable, catalog/output/API mount semantics pass |
| Scoped source/evidence/credential/diff checks | Pass |

The real-timer smoke invokes `RunScheduler`, the function used by release CLI
scheduled dispatch. It uses a synthetic test-only history provider and waits on
the actual one-minute timer; it does not call the function twice manually or
introduce a production fake-provider flag. The same-day second iteration avoids
a second provider fetch. The smoke also handles a legitimate cutoff advance
between iterations, which would require another fetch. Deterministic tests
separately assert the exact clock/catalog transitions and request counts.

## Runtime identity and isolation

The new image is
`sha256:6341966d32f78ce0adcdb235138a5fce45552bdeb8a9c05c3a0db9493832439b`,
with tag `signalgen-local-runtime:304e0b467531`. It was built using the unchanged
verified local COPY-only helper from exact source `304e0b4`. Runtime data inputs
are pinned to
`sha256:f1baf33b1e06c6a7b54f6226cf758785efd2efe99a358c9f613aa906da2077f4`;
the Go toolchain is
`sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61`.
No old application binary was inherited and no image was pushed to a registry.
This remains a local packaging path; it is not a clean build of the original
production Dockerfile.

All target execution used network-none containers, read-only root/source/toolchain
and private bounded scratch writes, explicit safe env with scratch HOME/tmp/cache,
no Docker socket/credentials, dropped capabilities and no-new-privileges. Native
checks used two CPUs, 2 GiB RAM, 256 PIDs, 128 MiB file-size limit, 1024 open files,
2 GiB scratch and a 360-second target deadline. The image test used the same
resource bounds, UID/GID 10001, disabled persistent logging and a 120-second Go
test deadline with a 140-second parent deadline. No normal authenticated API or
host service was started. Docker used the explicit local `orbstack` context;
the unchanged packaging helper selected that context through `DOCKER_CONTEXT`.

Build the local package from the repository root:

```sh
DOCKER_CONTEXT=orbstack PYTHONDONTWRITEBYTECODE=1 \
  python3 backend/scripts/build_local_runtime.py
```

For native checks, mount the helper's verified `source/backend` copy at `/target`
and the existing module cache at `/gomod`, both read-only, in the pinned Go image
with the limits above. Use the explicit empty env allowlist from
`backend/scripts/build_local_runtime.py`'s compile path, with GOPROXY/GOSUMDB off,
GOTOOLCHAIN local and scratch HOME/tmp/cache. From `/target` **inside that bounded
container**, run:

```sh
go test ./internal/collection ./cmd/collectidx -count=1
CGO_ENABLED=1 go test -race ./internal/collection ./cmd/collectidx -count=1
go vet ./internal/collection ./cmd/collectidx
```

The Go image includes the compiler needed by race tests; no dependency install
is needed. Do not mount the original backend directory, which may contain
ignored personal files, when the verified frozen source copy is available.

For the image smoke, use the helper's matching `context/tools/collection.test`
read-only at `/smoke` in the resulting immutable image, with the bounds above,
`TMPDIR=/scratch`, `HOME=/scratch`,
`SIGNALGEN_TEST_SCHEDULER_SMOKE=1` and
`SIGNALGEN_TEST_COLLECTOR_BINARY=/usr/local/bin/signalgen-collect-idx`, then run
`/smoke/collection.test -test.v -test.timeout 120s`. This runs the collection suite
and the one-minute timer fixture without external networking. The production
image itself contains no shell dependency for scheduling.

An intermediate edited disposable source snapshot failed formatting with
`expected '}', found 'EOF'`; a fresh immutable snapshot passed all final checks.
A parent-side Compose probe initially could not discover the CLI plugin/context
with scratch HOME (`unknown flag: --env-file`); rendering passed using the trusted
parent's client metadata and explicit empty envfile. Target HOME/env controls
were unchanged. No failed acceptance check was waived.

Graph checks used project `browser_regression_integration`, generation
`2026-11-12T14:25:07Z`. Existing collector, Sync, runner, catalog, retention and
related tests matched metadata. New scheduler files/Dockerfile were not tracked
and scripts/docs excluded; these were read directly. The graph trace was used
as a discovery aid, with current source as authority and no completeness claim.

## Remaining boundaries

No real operator catalog was supplied and no Yahoo/IDX coverage or freshness was
measured. No Linux/systemd or host schedule was installed, no live profile was
started and no production uptime or capacity claim follows. Single-file Docker
catalog binds see in-place changes; restart after an atomic host-file replacement.
An operator must provision private writable output permissions, durable space
and any filesystem quota; retention is not a disk quota.

Cache-generation integration belongs to a separate worker branch and is absent
here. This branch does not promise immediate API visibility after publication.
Unchanged frontend/core/API evidence remains tied to the prior
[integration](prof-local-docker-integration-20261112.md) and
[API-stack](local-api-stack-20261113.md) snapshots; no unrelated browser suite or
performance benchmark was rerun. Browser-to-real-API isolation, real providers,
premium specification/cost, staging/devices/full-user-load proof and the original
production recipe remain separate work.
