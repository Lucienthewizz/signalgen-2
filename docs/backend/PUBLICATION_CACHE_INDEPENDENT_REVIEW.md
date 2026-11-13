# Independent publication-cache review

No new defect was demonstrated within this review's scope on
`989db437def01951abce6aa7b23b2d70ca886f91`
(`frontend/publication-aware-cache`, ancestor
`4b2173c4199345770d58cbdcf927bfd3f193fada`). This is a bounded source/local-runtime
review, not a full security audit, whole-application approval or integration
merge. The reviewer did not implement this cache change or edit its production
source. Review delivery is on `frontend/publication-cache-independent-review`.

Independent focused tests and race checks passed. The report does not establish
real IDX freshness, live provider behavior or production capacity. Commands,
source hashes and probe results are in the
[evidence record](../evidence/publication-cache-review-20261113.json).

## Source and coherence

| Boundary | Review result |
| --- | --- |
| Revision and view | [snapshot.go](../../backend/internal/marketdata/snapshot.go), lines 15–29, selects the revision and provider view together. Literal nil views, empty/oversized/NUL revisions and snapshot errors are refused. Providers without the optional interface retain the existing upstream/TTL path. |
| Multi-instrument latest | [cache.go](../../backend/internal/marketdata/cache.go), lines 81–168, resolves once before symbol workers, includes the revision in entry/flight keys and passes the pinned provider into fetch. An independent five-symbol probe publishes B during the first A read: every result and warning stays A; the next call returns B. |
| History | [history_cache.go](../../backend/internal/marketdata/history_cache.go), lines 20–63, pins once per single-instrument call. Range keys retain nanoseconds. Separate calls can select A then B; neither the interface nor this review promises a transaction across those calls. |
| Dataset/grant freeze | [dynamic.go](../../backend/internal/dataset/dynamic.go), lines 222–235, returns owner-checked copied bytes/metadata. The worker's real-store A→B test was independently rerun and preserves dataset A bytes/checksum while rejecting another owner. Dataset and compute source are unchanged; grant binding logic in [issuance.go](../../backend/internal/compute/issuance.go) still references the frozen dataset version/checksum. No real PostgreSQL/grant runtime was rerun for this review. |
| Version provenance | [store_cache.go](../../backend/internal/collection/store_cache.go), lines 141–163, attaches the selected generation and archive date/coverage to per-series warnings. The generic source text describes an archive, without asserting an active scheduler or live Yahoo fetch. The Yahoo provider identifier remains a compatibility field. |

[Backtest preparation](../../backend/internal/dataset/backtest.go), lines 119–143,
issues separate per-instrument history calls. A publication during a multi-stock
preparation may therefore freeze series from different generations. Each series
retains its own provenance. This is a documented limitation of the per-cache-call
contract, not evidence of mutation of a previously frozen snapshot. A future
requirement for whole-study generation consistency would need an explicit batch
snapshot boundary; this review introduces none.

## Invalid publications, caching and budgets

[Pointer resolution](../../backend/internal/collection/store_cache.go), lines
45–115, validates `current.json` before any cache lookup. Pointer reads are capped
at 4096 bytes, reject nonregular files before open, validate the opened file,
refuse unknown/trailing JSON and constrain the generation to a bounded basename.
The byte limit is checked both by stat and by bounded read.

Independent probes warm both caches, then remove the pointer or replace it with
an empty/oversized/unknown-field/directory input. Both methods return unavailable,
without serving the warm entry. A newly published B with corrupt report metadata
also fails instead of falling back to A. Restoration recovers normally. Existing
worker tests for malformed, linked and missing-target pointers were rerun too.

The store retains one current validated metadata view. It rereads the bounded
pointer per logical request but parses catalog/report only when the generation
changes. An independent diagnostic temporarily renames a fixture catalog after
initial resolution: resolving the same revision still returns the identical
view. This observes metadata reuse; it deliberately violates the immutable-store
contract and does not endorse changing published metadata in place. Cold reads
still use the existing snapshot binding/checksum validation in
[runner.go](../../backend/internal/collection/runner.go), lines 239–298.

Default per-cache limits are unchanged: 64 combined latest/history entries,
32,000 cached candles and eight shared flights, with a five-minute TTL and
shorter timeframe policy where applicable. Callers can supply other validated
CacheOptions. Latest batches wait through at most three workers. Old/new
generations share the configured budgets.

An independent one-flight probe holds A, switches to B and cancels A's caller.
B correctly receives unavailable while the old independent flight occupies the
budget. After the shared timeout clears A, B succeeds. Cancellation does not
cancel other users' shared work or leak the flight. Consequently immediate
publication *selection* does not guarantee a successful new-generation response
under exhausted capacity. No stale A result was returned as B in these checks.
Returned data/warning cloning and non-snapshot provider behavior also passed the
existing focused tests under independent execution.

## Conditional concerns and limits

There are no confirmed findings to report to the coordinator. One deployment
condition remains unresolved: the correctness/latency assumptions of the chosen
private filesystem and its writers.

`readPublication` uses Lstat followed by Open/Stat, rather than a single
no-follow descriptor-relative open. An adversarial writer could change file
kind or links between those steps. Generation paths and reused metadata also
rely on a stable private root and immutable generation directories. The diff adds a read-only store adapter; publication writes remain the trusted
collector's responsibility. I did not demonstrate an API-controlled writer or
an unauthorized boundary crossing, so this is not
classified as a vulnerability. If deployment permits other untrusted writers,
review the mount/ACL model and descriptor-relative/no-follow handling before
using that topology.

Metadata resolution holds a mutex over filesystem reads. Cancellation is checked
before/after those operations; the 15-second shared fetch timeout starts later
and does not impose a deadline on an already-blocked file open/read or mutex
wait. The 4096-byte bound limits input size, not slow-storage latency. Validate
latency and failure behavior on the actual local/Docker volume; the current
synthetic tmpfs timings do not settle remote-storage or contended behavior.

Pinned archive views are references, not file-retention leases. Existing
[retention](../../backend/internal/collection/retention.go) preserves current and
recent generations and requires at least a 24-hour retirement grace. Normal
bounded fetches fit well inside that grace; a retained view used after its files
are legitimately pruned can fail a cold read. Dataset content already copied
into an owner snapshot does not depend on those files afterward. No retention
policy or live archive was changed by this review.

Future optional snapshot adapters must return a nonnil immutable view and a
revision that identifies its contents. To serve history through this wrapper,
both the upstream adapter and pinned view must implement `HistoryProvider`.
The actual StoreProvider does so; this review does not establish compatibility
for arbitrary future adapter implementations.

## Performance evidence and independent execution

The worker's validation/performance source-blob maps exactly match `989db437`.
Its raw synthetic evidence reports hot latest/history median sample means of
about 3.31/3.15 microseconds and one changed-generation read of 1.267304 ms. These
are reused worker measurements on 500 synthetic symbols/40 candles, local tmpfs
and GOMAXPROCS=1; no benchmark was independently rerun. The hot path became slower
than the old stale-hit path because it now checks publication. Direct/cold reads
improved through metadata reuse. Neither result establishes production
throughput, individual-request p95, concurrent pointer-lock performance or
1000-user capacity.

This reviewer independently ran focused cache/publication tests five times,
race variants three times, the dataset suite once with and without race, and
vet on those three packages. Four additional probe tests cover the real
five-symbol switch, warm pointer/new-target failures, metadata reuse/separate
history calls and shared generation-flight exhaustion/timeout. After gofmt-only
changes to retained probes, those four tests were rerun with race on the final
probe bytes. All passed in bounded non-root offline containers.

Graph index-status, symbol and exact-path coverage calls failed with
`Transport closed`. Current source and exact Git diffs were read directly,
including new files absent from the parent's older graph. No graph completeness
or exhaustive impact claim is made. Broad API/build tests remain the worker's
separately attributed evidence; scheduler, frontend, API-stack 240 requests and
other benchmarks were not rerun or merged in this task.
