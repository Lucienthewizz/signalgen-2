# Independent review of professor revisions

The bounded review found one cleanup reliability bug in API-stack harness commit
`4b2173c4199345770d58cbdcf927bfd3f193fada`. The coordinator's separate fix,
`5a560a8c240f40c1ce06075cc59a70542e4c850e`, addresses the reproduced failure;
its six focused tests also passed independently. This report branch contains no
implementation fix. The cleanup commit still needs separate integration.

No trust-boundary violation was demonstrated in this review. That statement is
limited to the paths and cases below; it is not whole-application approval.

## Independence and source ancestry

I previously authored target-hit metrics and evaluation UI. Those changes are
excluded from every independent-review claim here. For the cursor review, their
output is an opaque compatibility baseline, not independently approved financial
logic. Scheduler/cache workers' unfinished branches were not inspected or changed.

This branch starts from verified `origin/frontend/local-api-stack-verification`
at `4b2173c`. Its direct parent is integration `25ea6006daff8ac2a70f2481f4f0e37fa06b9038`.
At fetch time, `origin/frontend/prof-revisions-integration` still pointed to
`25ea600`; the API harness commit was not an ancestor of that integration ref.
The harness adds only test tooling and documentation. Protected application and
schema paths are byte-identical between packaged source `2c4ad1d`, integration
`25ea600`, and review base `4b2173c`.

| Revision | Independently reviewed responsibility |
| --- | --- |
| `cbcdfa3db92bd66a717e8e92934708b63a649e35` | Atomic study/screen snapshot reservation and shared capacity accounting |
| `f2928c8e7558a8d97a9bfd8ce09704b11be6eeae` | Eight-line chronological lookup change relative to the metrics base |
| `9137d7b8b4dd42c7ed3290dd8d8b3b0625aefc92` | COPY-only local runtime packaging and explicit input/mount configuration |
| `4b2173c4199345770d58cbdcf927bfd3f193fada` | API-stack test harness isolation, cleanup and evidence boundaries |
| `5a560a8c240f40c1ce06075cc59a70542e4c850e` | Follow-up cleanup-only fix, reviewed from Git objects without merging it here |

## Finding R1: one cleanup timeout skips later removals

**Priority:** repair before relying on the harness's failure-path cleanup.
This is ordinary test-harness reliability; no security severity is assigned.

At `backend/scripts/verify_local_api_stack.py:222–224` in `4b2173c`, the `finally`
loop calls `subprocess.run(..., timeout=20)` without handling removal exceptions.
A timeout removing an already-finished verification container aborts the loop,
so removal of the still-live API and PostgreSQL containers is not attempted.
A cleanup exception can also replace an earlier stack exception. Successful-run
cleanup evidence is unaffected by this conditional failure.

The [retained probe](../evidence/prof-independent-review-cleanup-probe.py) extracts
the exact original `finally` AST. Docker removals are mocked: with recorded names
`[own-pg, own-api, own-verify]`, the first removal raises `TimeoutExpired` and the
observed attempted list is only `[own-verify]`. No real deletion or control-plane
outage was induced. This reproduces skipped cleanup attempts, not an observed
production escape or a claim that the bounded child deadlines stop working.

The coordinator owns the fix on `frontend/local-stack-cleanup-reliability`.
The minimal change catches timeout, command and launch failures per resource,
continues the remaining exact-name removals, reports unresolved names, fails an
otherwise successful run, and preserves an existing stack exception. Commit
`5a560a8` implements that behavior. I inspected its full diff and independently
ran all six patched preflight/fault tests from a separate read-only source copy;
all passed. The original source in this report branch remains unchanged.

**Disposition:** addressed in independently checked commit `5a560a8`; integrate
that commit separately. An unresponsive daemon may still prevent deletion, but
the fix reports the condition and attempts the remaining bounded removals.

## Review observations

### Atomic reservations and frozen contexts

Primary paths were `backend/internal/dataset/{study_capacity,backtest,dynamic,study}.go`
and `backend/internal/api/backtests/studies.go`, with routing, caller recovery,
cloning and focused tests checked as supporting evidence.

Reservation admission counts published plus reserved slots globally and per
owner under one lock. Staged bytes enter the same byte budget. Commit validates
the live reservation/context/expiry and publishes its staged entries under that
lock; capacity failure discards only the new batch. Ordinary preparations consult
the reservation budget at publication. Release/expiry cancel the reservation and
clear staged bytes; late provider responses face context and reservation checks
before publication. Existing owner handles are not evicted to make room.

The handler keeps the existing owner/session/feature checks, frozen rule/catalog
metadata, unique retry subset checks, active-batch exclusion and post-fetch rule/
context validation. It retains provider-only partial results and distinguishes
whole-batch capacity refusal as retryable 429. Race tests exercised cancellation,
foreign-owner access/release, byte rollback, ordinary-handle preservation and
recovery after release. No confirmed defect was found in those reviewed cases.

Repeated prepares are not idempotent reuse of an active study batch: a new batch
must fit beside existing handles or be refused. This is an explicit documented
tradeoff, not an unreported eviction. The current frontend orchestrator releases
a batch after losing its prepare response before advancing/retrying. Frozen
catalog/rule metadata does not establish a single immutable upstream archive
generation across an entire multi-batch catalog run.

### Chronological candle cursor

The reviewed difference in `backend/core/signal_study.go:226–248` retains one
position per symbol and resumes at the previously matched index, including that
index. Validated candles have increasing UTC session dates; entries are sorted
by parsed instant and symbol before lookup. Therefore each symbol's valid entry
sequence is nondecreasing. Keeping the matched index preserves duplicate-instant
lookup so the existing rejection remains reachable. Unknown symbols, absent exact
timestamps, warmup violations and invalid entries still return before outcomes.

`RFC3339Nano` parsing and `Time.Equal` remain; no UnixNano range truncation or
string-order shortcut was added. I reran the 29-case complete result/error hash
oracle on the optimized core and on a disposable core copy with exactly the
metrics-base `5ceb705` lookup file restored. Both passed the same frozen oracle.
Cases include offsets, nanoseconds, extreme supported years, shuffled mixed-symbol
entries, duplicate instants, unknown symbols and a one-nanosecond mismatch. No
confirmed lookup/order/error regression was found. Own metric calculations were
not independently reviewed.

### Local COPY-only packaging

Reviewed files were `backend/LocalRuntime.Dockerfile`,
`backend/scripts/{build_local_runtime,test_local_runtime}.py`, and
`docker-compose.local-runtime.yml`.

The helper rejects executable/remote recipe instructions, hooks and unexpected
runtime metadata; snapshots bounded tracked compiler inputs, checks content against
Git, rejects leaf symlinks, and never mounts a personal env file into target code.
It compiles offline with read-only inputs/module cache and bounded scratch, then
accepts only named bounded regular ELF artifacts. Packaging starts from scratch
and copies reviewed CA/identity data plus rebuilt binaries. Final ownership/mode
and byte comparisons are explicit. Source/archive validation assumes a trusted
parent helper and working-copy environment; it is not protection against a
compromised host/operator.

I independently read all five binaries from the exact stopped local image
`sha256:cf5e1397b73b4e463b360897f19f5ac0fe02470288b025dd1114a614efa85a50`.
Every digest matched the retained integration packaging record, with UID/GID 0
and mode 0555. This corroborates the recorded image/artifact identity; it is not
a fresh independent rebuild of those five binaries. Compose keeps API store data
read-only, collector catalog read-only, collector state separately writable,
`pull_policy: never`, and the collector's validate-only/network-none default.
Config rendering is not scheduled activation or live IDX coverage.

The original packaging helper uses bare `docker`, so its operator must select
the intended local context; its name alone does not enforce that choice. The
API harness and every Docker command in this review explicitly select `orbstack`.

### Real API versus fixture evidence

Reviewed `backend/scripts/verify_local_api_stack.py` and
`backend/scripts/localstack/{main,main_test}.go` use pinned cached images,
network-none private shared loopback, read-only roots/source/store, scratch-only
writes, explicit child envs, resource/deadline bounds and exact generated names.
The actual API child is `/usr/local/bin/signalgen-api`; its composition uses real
repositories, sessions, grants and private scoring. The identity HTTP server and
market histories are fixtures; bootstrap writes target only the private fresh DB.
The client computes features/outcomes natively. No browser/WASM-to-real-API proof
is asserted.

The historical structured record's 45 grouped request rows sum to its claimed
240 assertions, and its helper source hash matches `4b2173c`. The published-image
source label and binary digests are consistent with the application tree at
`2c4ad1d`/`25ea600`. Its matched/unmatched and native handoff claims match the
helper's actual calls/assertions. These are reviewed historical results; I did
not rerun the full API/Postgres stack or its 240-request journey.

The harness compares manifest/grant metadata checksums, but does not independently
hash raw downloaded HTTP candle bytes before JSON decoding. Its native outcome
check asserts successful handoff/event count, not independent financial-formula
parity. Those are coverage limits, not demonstrated product defects.

## Actual checks and boundaries

The [evidence record](../evidence/prof-independent-review.json) retains source
identities, results, artifacts and the cleanup finding/fix disposition. Focused
checks passed: 19 Go top-level tests (including dataset/API race tests), paired
29-case cursor compatibility, five original Python preflights, and six patched
cleanup preflights. The original cleanup failure was positively reproduced with
mocked removals. It is resolved by the separate checked patch, not by this report.

All target execution used existing pinned offline Docker images, read-only
source/root/toolchain, non-root users, scratch-only allowlisted envs/writes and
CPU/memory/PID/file/disk/wall limits. No Docker socket or credentials entered a
container. Only this review's exact container IDs were cleaned up; no healthy
pre-existing service, image, other worktree or branch was altered.

Graph-first exploration used the refreshed `backtest-evaluation-options` index
at `2026-11-13T03:09:07Z`, symbol search, traces and exact snippets/coverage checks.
Primary Go paths had metadata-match/no-recorded-issue coverage. `backend/scripts`
is excluded, so those complete files were read directly. Route callbacks missing
from the call trace were verified in `routes.go`; graph absence was not used as
proof of no caller. The evidence ledger names the paths relied on.

This is not a full security audit, new throughput benchmark, production Dockerfile
build, host scheduling test, browser audit, live provider/Supabase check or review
of unfinished scheduler/cache work. No dependencies/images were fetched, no
personal env/cloud data was changed, and no scheduled service was activated.
