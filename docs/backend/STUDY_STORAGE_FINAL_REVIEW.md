# Independent Final Review: Study Storage Optimization

**Reviewed commit:** `834f3c62e2f9c3e3a1282d21d36fb320ea8a4c03`
**Product source reviewed:** `frontend/web/src/analysis/signal-study-storage.ts`
**Compared implementation:** `df92fc14a4637cca153b55a884731c1d0804a2b8`
**Baseline:** `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e`
**Scope:** report-only review of the final evidence and focused probes; no product acceptance or all-device performance claim.

## Result

No confirmed functional defect was found in the reviewed storage implementation. The final commit leaves the product source byte-identical to `df92fc14`; its changes are evidence, fixture, runner, and focused-probe updates. The recorded native correctness result supports closing R1-R3 for the exercised cases, with the runner reproducibility limitation below kept open.

## Source and evidence checks

- The new baseline fixture SHA-256 is `02d767b09aaf7d52c2eeb61ac886c8b51c53fa426a221691861463c3f7fef78c`, matching the exact baseline source bytes from `e74b1651`.
- The candidate source SHA-256 is `43f81fd8f588db1b069caff664d88ffb9182601bbca848b313754e578300d2fb`, matching the reviewed `df92fc14` source and the candidate hash recorded in the paired JSON/log.
- The paired artifact records three samples for each source per scenario, with one warmup and the documented `B-C, C-B, B-C` ordering. It records both source, runner, lockfile, and container-image hashes.
- The 15,000-event result is reported with the required trade-offs: CSV `1569.9 -> 101.6 ms`, store `188.8 -> 191.6 ms`, and cleanup `39.0 -> 40.1 ms`. The documents describe native Chromium and synthetic fixtures; these numbers do not establish production or all-device performance.
- The exact oracle result is internally consistent: 80 events and identical oracle, paginated, and CSV SHA-256 `ae0f70165a02abd6c9bb2c30662a3477947f9008aa03848d9d5c6162fecae5fe`.

## R1-R3 assessment

### R1: bounded pagination and export

**Closed for the recorded evidence.** The paired benchmark uses fresh databases and identical generated fixtures for baseline and candidate, measures page 0/middle/late pages and CSV export, and fails nonzero when a scenario or correctness invariant is false. The measured improvement is bounded to the stated native Chromium/container run.

### R2: cross-connection ownership and overwrite isolation

**Closed for the exercised schedules.** The browser probe creates two pages in one browser context and one origin, so they share IndexedDB storage. Different-symbol writes assert 25 rows, metadata total/counts, symbol presence, and a positive owner byte ledger; same-symbol overwrites assert one metadata entry, one winning batch, matching row/meta counts, and matching batch/owner bytes. The same-symbol winner is intentionally nondeterministic (10 or 20 events); this proves atomic consistency for the tested race, not a deterministic winner or every possible interleaving.

### R3: failure and semantic preservation

**Closed for the recorded cases.** The native probe records readonly abort rejection, quota rollback, pre-flight and mid-transaction cancellation rollback, overwrite accounting, legacy metadata initialization, owner cleanup, stable ordering, full numeric/null/outcome preservation, and exact canonical equality. The focused MockIDB tests are supplementary rather than native-runtime proof; the paired evidence records the native checks separately.

## Confirmed runner limitation

**Finding F1 — the checked-in isolated runner does not fully implement the documented execution controls.** `frontend/web/tests/browser/run-isolated-benchmark.sh:29-43` invokes `docker run` without `--context orbstack`, an explicit `--platform linux/arm64`, image/platform/hooks inspection, or file-size, disk, and wall-time limits. It also hard-codes a host-specific `REAL_NODE_MODULES` path without checking its existence or recording a dependency-tree hash. Therefore the script is not independently reproducible as written on another host, and the paired evidence's control description must be treated as recorded-run provenance rather than a self-validating reproduction recipe. Minimal fix: parameterize/validate the approved dependency snapshot and add the required context/platform/resource checks before retaining “reproducible isolated runner” wording.

F1 is a methodology/control finding, not evidence that the IndexedDB implementation is functionally defective. The report does not claim that the benchmark was rerun under controls unavailable to this review.

## Remaining bounded limitations

- The native probes cover two same-origin pages in one browser context, not workers, multiple browser contexts, or arbitrary schedules.
- The same-symbol probe validates a consistent winner and accounting, but not which writer wins or payload-level equality to a selected schedule.
- The readonly-abort probe is source-controlled and recorded as passing; this review did not rerun the full browser benchmark.
- Store and cleanup regressions are disclosed in the measurement table, including the larger `500 x 10` store delta; “preserved throughput” should not be read as no write-cost regression.

## Checks performed for this review

Static checks were performed against the pinned checkout: source equality to `df92fc14`, baseline fixture equality to `e74b1651`, paired JSON parsing and sample-count inspection, correctness/oracle inspection, runner-control inspection, and staged-scope review. No target benchmark or product test was executed on the unrestricted host; no production source, existing test, lockfile, or prior review artifact was changed.
