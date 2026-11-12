# Remaining professor requirements

Updated on 12 November 2026 after integrating storage decision `fffec6b`,
target metrics `5ceb705` and capacity control `cbcdfa3` onto the professor revision
branch. Combined source and overload UI verification is pinned to
`79a3f00576934173ad42f44bc303489a9dd79513`; commands and limits are in the
[follow-up evidence](../evidence/prof-revisions-followup-20261112.md).
Historical worker reports retain their original source snapshots and outcomes.

## Current evidence

| Category | Established | Limit |
| --- | --- | --- |
| Implemented and synthetically verified | Whole-batch slot reservation, staged byte accounting and atomic publication/rollback; HTTP 429 `SNAPSHOT_CAPACITY` with retry delay. Screen/study browser checks cover automatic/manual recovery, bounded retries and keyboard Stop with real WASM. | Capacity limits are unchanged. The worker's synthetic 1000-request wave still admits 32 contexts and rejects 968; 12 complete ten-stock batches fit, 20 batches are refused and eight spare slots cannot fit another ten. This is overload correctness, not 1000 completed users or a speedup. [Capacity contract](SNAPSHOT_CAPACITY_CONTROL.md). |
| Implemented and synthetically verified | Optional Go `target_hits`, weighted whole-study/stock/day aggregation, distinct target-only reached rate versus policy-resolved TP exit rate, legacy/no-target unavailable states and frozen-summary CSV. | Incomplete windows stay outside evaluated denominators. SL-first collisions remain SL, and a positive unhit time exit remains a win without a target hit. Daily timestamps identify candles, not intraday execution or broker fills. [Metric contract](TARGET_HIT_METRICS.md). |
| Decision documented | Retain native IndexedDB and current Go cache/file archive/Postgres layers; gate SQLite or search-index migrations on measured workloads. | No storage migration, new SQL index, deployed query plan or persistent offline authorization was introduced. The [storage decision](LOCAL_STORAGE_CACHE_DECISION.md) remains pinned to its earlier reviewed base; new capacity/metric behavior is described above. |
| Local runtime fallback verified | A compiled collector from merged source passes help, synthetic catalog validation, incremental publication, read-only archive reads and prune dry-run in a bounded, no-network container. Collection/CLI tests and vet pass. | This is compiled-binary evidence, not an exact Dockerfile image. Exact image build/smoke remains blocked by unestablished per-RUN isolation controls; no runtime image identity is claimed. Linux unit syntax/activation and real catalog/provider operations remain unverified. |
| Combined integration verified | 262 frontend tests, typecheck, full formatting, production build, asset budgets, five existing browser suites and the new eight-case overload matrix pass. Affected Go core/dataset/API tests, dataset/API race checks and vet pass. | Synthetic account/API/provider/private decisions; no live Supabase, provider or production-capacity validation. [Actual commands and recovery evidence](../evidence/prof-revisions-followup-20261112.md). |

## Next work in priority order

| Order | Remaining work | Acceptance or missing input |
| --- | --- | --- |
| 1. Capacity and measured performance | Profile sustained workloads and the remaining private-scoring/payload/storage costs. Preserve the new atomic refusal and provider-partial semantics. | Agree deployment topology, concurrency target and service-level objectives; measure completed/rejected/failed work, CPU/memory/storage and before/after stages. The original 10/100/500-symbol samples remain tied to their original benchmark commit/environment; they were not rerun here. [Baseline](SCREENING_PERFORMANCE.md). |
| 2. Storage/cache/index experiments | Follow the existing decision: measure IndexedDB page/export scans, archive reads and generation-aware provider-cache visibility before proposing a migration or secondary index. | Compare equivalent results, quota rollback, owner cleanup, cancellation, query plans and write/index costs on isolated fixtures. Deployment volume topology remains unknown. No SQLite migration is required merely because SQLite was discussed. |
| 3. Exact image and Linux operation | Provide a build environment enforcing the required offline, read-only, scratch-only and bounded per-RUN controls with preseeded dependencies, then build and smoke the exact runtime image. Review/install the scheduler only on an authorized chosen Linux target. | Record immutable image ID, non-root collector packaging, matching API/WASM, syntax checks and timer logs. A managed platform may need a different scheduler and durable-store design. Existing sample units have not been activated. |
| 4. Real full-catalog data validation | Obtain a current legally usable catalog and authorized data source; inspect a bounded acquisition and publication before broad operation. | Report expected/attempted/successful/failed tickers, available dates, freshness/cutoff, null/open rows, adjustments, checksums and retained rollback. Missing data remains coverage failure, not No match. Live Yahoo and actual full IDX coverage remain unverified. |
| 5. Historical universe | Obtain listing/delisting membership effective dates if research requires point-in-time claims. | Today's catalog is frozen per study, not reconstructed at each historical signal date. Label current-snapshot studies as survivorship-limited until membership provenance is available. |
| 6. Premium provider | Wait for provider name, official API specification, costs/licensing, symbol mapping, adjustments, rate limits and cache/redistribution rights. | Contract fixtures, provenance, parity and an agreed cost ceiling precede live requests. Do not invent endpoints or silently replace a frozen study's source. |
| 7. Staging/device/full-user-load proof | Validate the combined candidate on an authorized staging topology and representative browsers/devices, then controlled synthetic sustained load. | Record multi-instance routing/ownership, revocation, storage/quota, retry/Stop, throughput/p95 and rejection counts. Keep real provider/database validation separate and quota-bound; no production execution, performance or user-capacity claim follows from these local checks. |

These remaining items are operational evidence, research inputs or proposed
experiments; they are not all implementation defects. No cloud mutation,
production deployment, scheduler activation or actual catalog download occurred
in this follow-up. The exact-image and unit-tooling blockers are explicit in the
[verification record](../evidence/prof-revisions-followup-20261112.md).
