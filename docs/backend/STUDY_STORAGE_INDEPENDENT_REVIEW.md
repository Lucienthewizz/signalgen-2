# Independent review: study storage optimization

**Reviewed commit:** `df92fc14a4637cca153b55a884731c1d0804a2b8`
**Baseline:** `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e`
**Review scope:** `signal-study-storage.ts`, focused unit test, browser benchmark, measurement notes, and checked-in evidence.

## Result

The source change is a plausible bounded-pagination optimization, and the checked-in focused tests exercise exact tuple expansion, pagination, legacy metadata initialization, overwrite accounting, owner cleanup, cancellation, quota rejection, and an 80-event canonical oracle. I found no confirmed functional defect in the source by inspection.

The performance and concurrency conclusions are not ready for integration as stated. The artifacts support a **candidate/native-runtime result**, not a reproducible head-to-head measurement or proof of cross-connection concurrency.

## Findings

### R1 — Benchmark provenance does not identify the measured source

**Classification:** confirmed evidence defect; performance conclusion unresolved.
**Trigger:** `docs/evidence/study-storage-baseline-20261116.json` has no source SHA, runner SHA, lockfile SHA, or fixture identifier. The optimized JSON has no environment or source provenance. `study-storage-benchmark.mjs:15-17` transpiles whichever source file is present at runtime.

The baseline JSON contains one value per metric, while the optimized JSON contains three samples. The notes claim “1 warmup + 3 paired timed iterations,” but the checked-in baseline does not retain those samples, and no artifact proves that both runs used equivalent source snapshots, fixture generator, browser command, and environment. The repository currently proves that the reviewed source is present at `df92...`; it does not prove that the reported optimized or baseline measurements came from those exact source snapshots.

**Consequence:** `1524 -> 90.1 ms`, the speedup table, and “paired” wording should not be treated as independently reproducible evidence. This is not a source correctness failure.

**Minimal fix:** record, for each run, the exact source SHA-256, benchmark-file SHA-256, `package-lock.json` SHA-256, commit SHA, image digest/platform, command line, fixture parameters, and all raw samples. Run baseline and candidate in fresh contexts with a documented randomized or alternating order.

### R2 — “Concurrent writers” does not test separate connections or same-symbol races

**Classification:** confirmed coverage gap; candidate behavior risk, not a confirmed defect.
**Trigger:** `study-storage-benchmark.mjs:330-430` calls both stores from one page and one module, and `study-storage.test.cjs:543-560` uses a mock whose transaction queue serializes operations. Neither test opens two browser contexts/connections. Both tests use different symbols only.

The implementation’s IndexedDB readwrite transactions should serialize at the database level, but that behavior is not established by these tests. Same-symbol concurrent overwrite is also untested, so final event count, bytes, and `RunMeta` replacement are not independently demonstrated under that schedule.

**Consequence:** the report may say “same-page concurrent calls passed,” but not “concurrent writers across connections passed” or “no same-symbol lost update.”

**Minimal fix:** add a native browser probe with two pages or workers, each opening its own connection. Cover different-symbol and same-symbol writes, then assert exact rows, total, owner byte ledger, and metadata after both promises settle. Keep the mock test as a fast unit check, not as native concurrency proof.

### R3 — Requested readonly-failure and write/cleanup tradeoff evidence is incomplete

**Classification:** confirmed disclosure/coverage gap.
**Trigger:** the focused unit tests and benchmark assert cancellation, quota, cleanup isolation, and normal reads, but do not force a readonly transaction failure. The optimized 500-symbol/30-event evidence reports cleanup median `41.7 ms` versus baseline `35.5 ms` (`+17.5%`), with a range up to `44.4 ms`; the measurement note labels cleanup “bounded cursor cleanup” without calling out this regression.

The source does reject `studyEventPage` on transaction error, but that path is source-inspected rather than runtime-probed. The available evidence does establish exact canonical equality for the 80-event oracle, including nulls and timestamps across pagination and the export-shaped pagination loop.

**Consequence:** read-failure behavior and cleanup cost remain needs-validation, and “throughput preserved” is too broad when the baseline was not repeated and cleanup is slower in the supplied workload.

**Minimal fix:** add a bounded native readonly-failure probe or mark it needs-validation; report store and cleanup as separate metrics with raw samples and confidence limits. Avoid a general “throughput preserved” claim unless the paired data supports it.

## Checks performed

- Confirmed `HEAD` exactly matches `df92fc14a4637cca153b55a884731c1d0804a2b8`.
- Compared the reviewed source against baseline `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e`.
- Inspected callers in `signal-study-panel.tsx`, `signal-study.ts`, and identity cleanup.
- Checked benchmark assertions exit nonzero when `verified` or correctness assertions are false (`study-storage-benchmark.mjs:756-779`).
- Ran `node --check` for the focused test and benchmark inside the approved Playwright ARM64 image, with `--network none`, non-root UID, dropped capabilities, read-only root, read-only own staging mount, bounded CPU/RAM/PIDs, and tmpfs scratch.
- Did not run the target test suite or browser benchmark because the checked-in artifacts do not provide the required reproducible baseline provenance and this review does not weaken the requested execution isolation.

## Artifact hashes

See `docs/evidence/study-storage-review-20261116.json` for SHA-256 hashes of the reviewed source and evidence files, plus the exact check results.

## Decision

**Source review:** no confirmed functional defect found.
**Integration recommendation:** hold the performance/concurrency claims until R1-R3 are addressed or explicitly downgraded to candidate/needs-validation statements. This review is not approval of the whole application, all devices, or production performance.
