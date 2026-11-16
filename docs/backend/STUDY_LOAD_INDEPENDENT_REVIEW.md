# Independent review: sustained study API load

**Reviewed commit:** `cd49dd66fe22ecaced90a02c35c5399069eed93a`
**Tested source commit:** `d8a36cb3fdfae97085dd2ce8d83c41429182931a`
**Baseline:** `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e`

## Result

The reviewed commit is an evidence-only follow-up. The four scoped source and runner files are unchanged between `d8a36cb` and `cd49dd6`, and the primary evidence JSON records `source_commit: d8a36cb`. The 16-November evidence supports a real closed-loop `httptest` workload: all three batches and 23 stocks per completed study, four deterministic SELL events per stock, four concurrency tiers, at least five seconds of measured time per tier, admitted-only context peaks, bounded retries, and post-tier capacity reuse.

No confirmed functional defect was found by source inspection. The result is not production capacity proof: identity, sessions, entitlement, catalog, daily prices, and compute grants are synthetic in-memory dependencies; HTTP is local `net/http/httptest`; PostgreSQL, live Supabase/Yahoo, and a production WASM deployment were not exercised.

## Findings

### R1 — Mid-lifecycle failure cleanup is not runtime-proven

**Classification:** confirmed coverage gap; candidate cleanup risk, not a confirmed defect.

`executeWholeStudyLifecycle` defers context deletion after a successful `201`, and the normal measured path releases each prepared batch before deleting the context. The targeted fault test covers malformed create, foreign-owner access, and post-test capacity reuse, but it does not inject a failure after admission during batch prepare, dataset content, grant issuance, signal evaluation, or batch release. The source therefore shows an intended cleanup path, while the runtime evidence proves normal completion and overload recovery rather than cleanup after each mid-lifecycle failure point.

**Minimal fix:** add one bounded failpoint or test-double failure after admission and after a prepared batch, then assert the context and snapshots are released and the full 32-context/12-batch capacity can be reused. Keep the existing normal-path proof.

### R2 — Rejected-attempt latency is not reported separately

**Classification:** confirmed measurement gap; no source defect established.

The runner records `attempt` latency for every outcome and `completed_lifecycle` latency only for completed outcomes. A 429 retry or retry-budget exhaustion is counted as `rejected`, but rejected attempts are not placed in a separate latency series or percentile output. The evidence can therefore support all-attempt and completed-lifecycle latency, but not a distinct rejected-latency result.

**Minimal fix:** record `rejected_lifecycle` latency, including whether rejection occurred at context admission or batch preparation, and emit its p50/p95/p99 separately. Preserve the existing all-attempt and completed series.

## Checks performed

- Confirmed `HEAD` is exactly `cd49dd66fe22ecaced90a02c35c5399069eed93a`.
- Confirmed the four scoped source/runner files have no diff between tested `d8a36cb3fdfae97085dd2ce8d83c41429182931a` and reviewed `cd49dd66fe22ecaced90a02c35c5399069eed93a`.
- Confirmed the primary evidence JSON is schema 3, names `d8a36cb`, records four runs, and each measured duration is at least 5,000 ms.
- Inspected source accounting: attempts are incremented once per whole-study lifecycle; completed, rejected, failed, and cancelled are disjoint outcome counters; admitted context tracking starts only after HTTP 201 and decrements only after HTTP 204.
- Inspected retry controls: batch retry loop is capped at three attempts, parses `Retry-After`, and stops when the wait exceeds the remaining tier budget.
- Inspected the canonical oracle: each completed symbol must produce exactly four SELL events at the expected timestamps and prices; a completed study must cover 23 distinct stocks and 92 events.
- Inspected post-tier reuse: zero tracked snapshots, 32 fresh contexts, 12 held batches, expected 429 headers, cleanup, and zero tracked snapshots afterward.
- Inspected the runner statically; no target Go test or load profile was executed on the host. No runtime-pass claim is made for this review.
- Ran read-only Python and shell syntax checks for the helper and runner inside the pinned approved ARM64 Python and Go images with offline networking, non-root users, dropped capabilities, bounded resources, and an own read-only staging mount.
- Treated `study-sustained-load-20261118.*` as superseded historical evidence because its own warning identifies the first-symbol burst probe and missing source metadata.

## Artifact hashes

See `docs/evidence/study-load-review-20261116.json` for SHA-256 hashes of the reviewed source, runner, and evidence artifacts.

## Decision

**Scoped source review:** no confirmed functional defect found.
**Evidence status:** suitable as bounded synthetic closed-loop evidence with R1-R2 recorded; not approval of production capacity, persistent-database behavior, live provider behavior, or whole-application readiness.
