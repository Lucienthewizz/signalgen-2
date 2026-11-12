# Remaining professor requirements

Reviewed on 12 November 2026 at integration base
`757c7e6c338c7c875d3476a99f5270977c2f0efa`. This is an implementation and
verification plan, not a claim that every remaining item is a product defect.
Parallel workers own capacity/performance and aggregate hit-metric implementation;
their later branches need separate review and integration before changing this
snapshot. No implementation, deployment or live data changed in this document task.

## What the evidence currently establishes

| Evidence category | Established at the reviewed base | Limit |
| --- | --- | --- |
| Implemented in source | Market-wide historical signal search; server private scoring with browser Go/WASM features and outcomes; paged temporary IndexedDB results; exact, target-only and TP/SL evaluation choices. | Independent overlapping signals do not form a portfolio. A hit timestamp identifies a daily candle, not an intraday execution. [Evaluation contract](BACKTEST_EVALUATION_OPTIONS.md), [execution loop](../../frontend/web/src/analysis/signal-study.ts#L365). |
| Implemented in source | Bounded provider cache, owner-bound dataset snapshots, five-year incremental collection, immutable publications and retention. | Process-local capacity remains bounded. Publication visibility is subject to the provider cache TTL; a source feature does not establish deployment or freshness. [Storage/cache decision](LOCAL_STORAGE_CACHE_DECISION.md), [sync implementation](../../backend/internal/collection/sync.go#L38), [retention](../../backend/internal/collection/retention.go#L75). |
| Tested with synthetic fixtures | The integration report records 258 frontend tests, typecheck, build, budgets, full formatting and four Playwright suites passing; study/market/evaluation used real WASM and IndexedDB. | Account/API/provider/private decisions were mocked. These are prior recorded results at the integration base, not tests rerun for these documents. [Combined verification](../evidence/prof-revisions-integration-20261112.md). |
| Tested with synthetic fixtures | Prior performance evidence covers 10/100/500 symbols and isolated admission. | No measured optimization or 1000-user capacity proof. The benchmark separates native/browser/admission observations and their exclusions. [Performance baseline](SCREENING_PERFORMANCE.md). |
| Operationally unverified | Linux service/timer examples, store selection and retention controls exist. | Server timer activation, a new runtime image build, actual full IDX coverage, freshness and live Yahoo acquisition were not verified. [Operations and recorded test limits](IDX_SCHEDULED_SYNC.md). |
| Requires external input | Deployment target/volume topology, premium API name/specification/cost/licensing, current legally available catalog and staging access. | These determine implementation and validation choices. Record them as missing inputs; do not invent provider endpoints, prices or server capabilities. |

## Prioritized next work

Priorities describe delivery order and dependencies. They are not vulnerability
severity ratings or evidence that an existing control is broken.

| Order | Work and owner boundary | Completion evidence |
| --- | --- | --- |
| 1. Capacity and performance | Separate implementation worker: profile admission, snapshot bookkeeping, private scoring payload and the measured slow stages. Keep bounded concurrency, cancellation, ownership, complete candidate histories and output semantics. | Compare frozen before/after outputs and stage timings on isolated fixtures; include admitted/rejected/failed counts, memory and traffic. Resolve snapshot-capacity failures for the claimed workload without bypassing limits. Agree target concurrency/SLO and deployment topology before a capacity claim. |
| 2. Storage/cache/index decision | This document task: retain IndexedDB and current backend stores; use the [decision and experiment gates](LOCAL_STORAGE_CACHE_DECISION.md). A later implementation slice can optimize paging or cache generation visibility if measurements justify it. | Decision is documented now. Before changing storage, measure page/export latency and quota/cancellation behavior; before a SQL index migration, verify equivalent results and representative isolated query plans. Neither SQLite migration nor a deployed index is claimed here. |
| 3. Honest aggregate target metrics | Separate metric worker: expose hit counts/rates with explicit eligible, evaluated, incomplete and provider-failure denominators. Keep target-hit rate distinct from positive-return win rate and preserve TP-only versus SL-first TP/SL behavior. | Unit and browser cases must include a positive unhit time exit, negative unhit exit, incomplete window, TP hit and same-candle TP/SL. Align summary, details and CSV. At this base the separate aggregate hit rate is absent; daily hit timestamps already exist. [Current meanings](BACKTEST_EVALUATION_OPTIONS.md). |
| 4. Actual full-catalog data and scheduler operation | After selecting the target host, confirm a valid current catalog and permitted data source; build the runtime image, backfill, inspect reports, and install/review the scheduler appropriate to that host. This task does not activate it. | Record expected/attempted/successful/failed tickers, available date ranges, cutoff/timezone, null/open rows, corporate-action caveats, checksums and last successful publication. Demonstrate a bounded retry, no-op repeated daily run, incremental overlap correction, timer run/log, read-only API serving and retention dry-run/rollback on authorized non-production data. Missing listings or provider errors remain explicit coverage failures, not No match. |
| 5. Historical universe validity | Freeze and label catalog provenance now; obtain historical listing/delisting membership if the research requires point-in-time universe claims. | Present current-snapshot studies as survivorship-limited. A historical study must bind membership effective dates, listing changes and rule/data versions. The [study context](../../backend/internal/api/backtests/studies.go#L135) freezes today's selected catalog at run creation; it does not reconstruct membership at each historical signal date. |
| 6. Premium provider integration | Wait for name, official API specification, authentication/rate limits, daily/intraday conventions, adjustment semantics, coverage, redistribution/cache rights and costs. Then propose an adapter and mapping behind the existing provider boundary. | Contract fixtures, provenance mapping, error/retry limits, parity checks and agreed cost ceiling precede any live request. Premium data must not silently replace the frozen Yahoo/archive source in an existing result. |
| 7. Staging, device and user-load proof | After the prior slices, validate the combined candidate in an authorized staging environment and representative browsers/devices. Deployment topology and target SLO are prerequisites. | Check multi-instance ownership/context routing, revocation and cleanup, CPU/memory/disk/quota, throughput/p95/rejections, stop/retry behavior and provider-independent synthetic load first. Record real provider/database validation separately within allowed quotas. A 1000-request admission test is not 1000 completed full-market users. |

The existing Linux sample [service](../../deploy/systemd/signalgen-idx-sync.service#L13)
requests five years with seven-day overlap and a private state directory; the
[timer](../../deploy/systemd/signalgen-idx-sync.timer#L6) is boot-triggered and
hourly in Asia/Jakarta. A managed platform might need a different scheduler and
durable-volume arrangement. Choose that from the actual deployment target before
installing units or deciding on server-local SQLite. No target was assumed here.

## Delivery boundaries and handoff

The storage decision and this gap plan are complete as documents. The future
experiments and operational acceptance above remain separate work. Do not
reclassify them as implemented merely because a plan, migration definition or
sample service exists. In particular, schema definitions are source evidence;
deployed schema state and query-plan performance are still unknown.

The review used the current worktree graph with exact-path coverage and direct
source fallback for excluded migrations, deployment files and reports. Coverage
is best-effort and bounded to the paths recorded in
[review evidence](../evidence/local-storage-cache-20261112.json), not a whole-app
security audit. No cloud/database query, provider download, systemd operation,
browser/server launch or product test was needed for this documentation-only task.
