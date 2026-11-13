# Scheduler integration and bounded independent review

Reviewed scheduler `f919f358056014de2741fc8d3259f9f1c8aa9454` and merged it into
`8bbada0e47eb61ca66618c48af173d94d03a5d95` with history-preserving merge
`99d94b9df38e306cfb9b82e18c6b70f3c8260341`. No conflicts or implementation edits
were needed. No confirmed defect was found in this scope; this is not whole-app
approval. The reviewer did not author the scheduler and makes no independent
review claim for their earlier target metrics/UI.

## Source review

Read the scheduler and CLI implementation/tests, Compose profile, operator guide
and worker evidence at the exact scheduler tip. Followed the current `Sync`,
`Run`, catalog, publication/retention and Yahoo cancellation paths directly.
The worktree graph transport returned `Transport closed` for indexing/coverage;
no fresh worktree coverage is claimed. Parent metadata reports generation
`2026-11-13T03:23:32Z`, matching collector main but missing the new scheduler.
Direct source is the review authority; graph absence establishes nothing here.

| Boundary | Review result and limit |
| --- | --- |
| Scheduling and time | A single synchronous loop runs immediately, then waits after completion. Every iteration rereads catalog contents and recomputes Asia/Jakarta cutoff and five-year window. It has no goroutine overlap or catch-up queue. The 18:00 WIB rule is conservative wall time, not an exchange calendar or finalized-data guarantee. |
| CLI compatibility | Scheduling defaults off. Scheduled dispatch requires incremental/full-catalog/five-year/seven-day-overlap mode and rejects explicit frozen dates and contradictory modes. Timing flags without schedule fail explicitly. Default one-shot/validate/prune behavior remains. Library timeout accepts positive subminute values for tests; CLI minimum is one minute. |
| Cancellation and retries | Run context/deadline reaches Sync, provider/pacing and retention; Yahoo uses context-bound HTTP requests. Errors select retry delay; successful checks select normal delay. Parent cancellation stops waiting/loop. Cancellation is cooperative: bounded catalog parsing, filesystem calls and synchronous observer are not forcibly interrupted. This does not promise hard wall-clock termination for a blocked filesystem/provider. |
| Publication and locks | Existing Sync/Run exclusive locks are deferred for cleanup; failed/partial collection retains previous publication. Sync returns before retention acquires the same store lock. An external collector can win between them, causing a retryable retention/lock error, rather than overlapping writes. Atomic publication/retirement logic is unchanged. Retention runs only after successful Sync, validates current data and keeps rollback/grace rules. Force-kill/stale-lock recovery and disk quota remain operator concerns. |
| Catalog and mounts | Regular-file/size checks and existing catalog parser are reused. Each iteration reloads visible contents; a single-file bind can retain an old inode after host rename, as the guide discloses. Catalog is operator-controlled, read-only in the service; writable state is separate and API state mount stays read-only. This is not protection against a hostile operator or filesystem. |
| Activation/network | Scheduler is an opt-in profile, non-root/read-only root, dropped capabilities, bounded scratch/resources, direct executable and disabled inherited API healthcheck. Its service may use real networking if explicitly started; ordinary collector remains network-none/validate-only. No live profile, host timer or provider was activated. Operator-owned catalog, output permissions, data rights and durable space are required. |

## Fresh merged checks

[Structured results](prof-scheduler-integration-20261113.json) retain exact output,
source identities and sandbox controls. Fresh checks on merge `99d94b9`:

- `go test ./internal/collection ./cmd/collectidx -count=1`
- `go test -race ./internal/collection ./cmd/collectidx -count=1`
- `go vet ./internal/collection ./cmd/collectidx` and scoped gofmt check
- Nine Python packaging and API cleanup/preflight tests
- Compose config with empty interpolation/service envfiles and synthetic existing paths, both default and scheduler profile; assertions cover opt-in behavior, command, UID, read-only root/catalog/API store, writable collector store, missing-bind refusal settings and capability restrictions
- Ancestry, protected-source scope, local document links, syntax, whitespace and credential review

Native/Python target execution used existing pinned Go/Python images, explicit
`orbstack`, network none, read-only root/source/modules, non-root 65534, empty
environment allowlist, dropped capabilities, no-new-privileges and private
bounded scratch. Go: 2 CPU/2 GiB/256 PIDs/128 MiB file/2 GiB scratch, 360-second
child and 390-second parent deadlines. Python: 1 CPU/128 MiB/32 PIDs/8 MiB file/
16 MiB scratch, 20/30-second deadlines. No Docker socket or credentials were
mounted. Trusted-parent Compose rendering read client metadata but did not start
services. Only exact own recorded container IDs and temporary snapshots were
removed; absence was checked. No install, image pull or daemon restart occurred.

## Reused proof and identity

All 355 tracked compiler inputs match scheduler product commit
`304e0b4675313b3599f40ad502140493f0cb16ee` byte for byte. Their SHA-256 map,
serialized with sorted keys and compact JSON separators, hashes to
`1d673e8427fb1fbbeb7c553f82a264e17a81415b16b9649cfc4b021709f4f2c8`, matching
[worker evidence](local-idx-scheduler-20261113.json). Recipe, build helper and
Compose match that branch. Existing local image
`sha256:6341966d32f78ce0adcdb235138a5fce45552bdeb8a9c05c3a0db9493832439b`
was inspected: its revision label is `304e0b4`. It was not rebuilt or re-executed
here. Reused worker evidence covers five packaged binaries/digests, eight CLI
cases and the real one-minute production-function timer with two autonomous
iterations and one synthetic fetch. Documentation/test-helper changes in the
integration history do not become compiler inputs. The combined cache/scheduler
image remains deferred until cache integration.

Outside the allowed collector/scheduler files, backend product source, contracts,
frontend product source/lockfile and migrations match `8bbada0`; the integrated
cleanup fix remains unchanged. Earlier 262 frontend tests, six browser suites,
core/golden/race/vet and API 240-request evidence are reused at their original
source snapshots, not claimed as fresh runs. The API proof uses real packaged
API/restricted Postgres with mock IDP and native feature/outcome client, not a
browser. Original review findings and failed preflights remain intact.

The publication-aware cache branch is still separate and unreviewed here. No
real full-catalog coverage/freshness, live Yahoo, production uptime, Linux host
activation, original production-recipe build, 1000-user capacity or browser to
real API proof follows. See [current gaps](../backend/PROF_REMAINING_GAPS.md).
