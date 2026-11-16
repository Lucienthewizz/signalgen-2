# Sustained HTTP Signal-Study Workload Measurement Evidence — 18 November 2026

> [!WARNING]
> **SUPERSEDED HISTORICAL PROBE**: This document and [`study-sustained-load-20261118.json`](./study-sustained-load-20261118.json) record an initial burst probe (28..77 ms per tier) that evaluated only the first symbol of batch 0. The date header also incorrectly referenced future 18 Nov 2026 rather than the current environment date (16 Nov 2026).
> This probe is superseded by the verified sustained workload measurement (>=5 s per tier across all 23 stocks and 3 batches, dated 16 Nov 2026) documented in [`study-sustained-load-20261116.md`](./study-sustained-load-20261116.md) and [`study-sustained-load-20261116.json`](./study-sustained-load-20261116.json).

## Source Base and Environmental Controls

All tests and measurements were executed against the checked-out worktree branched from base commit `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e` (latest user frontend additions).

| Item | Pinned Identity / Value |
| --- | --- |
| Base Commit | `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e` |
| Worktree Branch | `frontend/prof-api-sustained` |
| Docker Image | `golang:1.27.2-bookworm` (`sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61`) |
| Isolation Controls | `--network none`, `--read-only`, `--user 65534:65534`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--cpus 2`, `--memory 2048m`, `--pids-limit 128`, `--tmpfs /scratch:rw,exec,size=2147483648,mode=1777` |
| Environment Allowlist | `env -i PATH=... HOME=/scratch/home TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local` |
| Shared Containers | `signalgen-2-go-api-1` and `signalgen-2-backend-1` preserved untouched and healthy |

## Measurement Summary

The opt-in sustained workload executed full HTTP lifecycles (context creation, atomic batch snapshot preparation, content retrieval, feature calculation, grant issuance, signal evaluation, batch release, and study cancellation) across four concurrency tiers:

| Metric | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Target Attempts** | 10 | 40 | 90 | 120 |
| **Initiated Attempts** | 10 | 40 | 90 | 120 |
| **Completed Lifecycle** | 10 | 40 | 81 | 88 |
| **Capacity Rejected (429)** | 0 | 0 | 9 | 32 |
| **Unexpected Failures** | 0 | 0 | 0 | 0 |
| **Cancelled** | 0 | 0 | 0 | 0 |
| **Max Inflight Contexts** | 1 (limit 32) | 10 (limit 32) | 30 (limit 32) | 32 (limit 32) |
| **Max Inflight Snapshots** | 10 (limit 128) | 100 (limit 128) | 120 (limit 128) | 120 (limit 128) |
| **Wall Duration** | 28.81 ms | 38.24 ms | 77.03 ms | 75.23 ms |
| **Throughput (Completed/s)** | 347.09 | 1,046.16 | 1,051.47 | 1,169.73 |
| **Throughput (Attempts/s)** | 347.09 | 1,046.16 | 1,168.30 | 1,595.08 |
| **Request Traffic (Sent)** | 143.7 KiB | 575.0 KiB | 1,165.6 KiB | 1,269.2 KiB |
| **Response Traffic (Received)**| 258.3 KiB | 1,033.4 KiB | 2,105.7 KiB | 2,291.2 KiB |

### Latency Percentiles by Stage (Milliseconds)

| Stage | Concurrency 1 (p50 / p95 / p99) | Concurrency 10 (p50 / p95 / p99) | Concurrency 30 (p50 / p95 / p99) | Concurrency 40 (p50 / p95 / p99) |
| --- | --- | --- | --- | --- |
| **Create Context** | 0.04 / 0.45 / 0.45 | 0.87 / 2.21 / 2.66 | 1.23 / 5.88 / 8.86 | 0.88 / 4.63 / 6.69 |
| **Prepare Batch** | 0.67 / 4.16 / 4.16 | 2.96 / 7.23 / 7.27 | 4.05 / 55.84 / 59.26 | 4.03 / 59.16 / 59.34 |
| **Private Evaluate** | 0.48 / 8.40 / 8.40 | 2.93 / 5.16 / 5.31 | 3.39 / 6.63 / 8.35 | 3.10 / 6.41 / 8.65 |
| **Release & Cancel** | 0.04 / 0.11 / 0.11 | 1.65 / 2.72 / 4.63 | 2.14 / 4.96 / 5.33 | 1.35 / 4.08 / 5.85 |
| **Overall Lifecycle** | 1.73 / 8.97 / 8.97 | 8.91 / 12.30 / 16.25 | 13.81 / 61.71 / 62.24 | 8.80 / 60.47 / 61.05 |

### Go Runtime Memory Consumption

| Metric | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Heap Alloc Delta** | +817.4 KiB | +1.71 MiB | +4.12 MiB | +4.20 MiB |
| **Total Alloc Delta** | 9.91 MiB | 38.68 MiB | 78.41 MiB | 85.60 MiB |
| **Heap Mallocs** | 70,718 | 277,271 | 569,916 | 623,365 |
| **Heap Frees** | 66,391 | 267,943 | 546,447 | 600,524 |
| **GC Cycles** | 5 | 19 | 27 | 25 |

## Deterministic Invariant and Recovery Verification

1. **Outcome Integrity:** Across all four runs (260 total attempts), the outcome partitioning holds without discrepancy:
   $$\text{attempts} = \text{completed} + \text{rejected} + \text{failed} + \text{cancelled}$$
   Zero unexpected HTTP errors (`failed = 0`) and zero drops (`cancelled = 0`) occurred.
2. **Hard Cap Adherence:** Observed inflight contexts capped strictly at 32 during the 40-concurrency saturation run. Observed inflight snapshots capped strictly at 120 (12 batches $\times$ 10 symbols), within the 128 limit.
3. **Overload Recovery:** When context slots were saturated (32 active), the 33rd request received 429 `STUDY_CAPACITY` with `Retry-After: 60`. Cancelling an active context allowed the rejected request to retry and immediately succeed with 201 Created. When snapshot capacity was saturated (120 snapshots), the 13th batch prepare received 429 `SNAPSHOT_CAPACITY` with `Retry-After: 1`. Releasing an active batch allowed the blocked batch to retry and immediately succeed with 200 OK.
4. **Zero Retained Leak:** Monitored snapshot tracking and post-run admission confirmed that after all client contexts and batches were released, active contexts in the handler and active entries in the dynamic store were 0. Full 32-context fresh admission was immediately demonstrated.

## Defect Investigation Outcome

No recovery defect was found in the scoped HTTP handler or dynamic store implementations. The system cleanly surfaces 429 backpressure and immediately recovers capacity upon resource release. Because no defect was detected and throughput meets expectations, no code modifications outside ownership or paired optimization runs were required.

## Exact Reproducibility Commands

To re-run the complete verification suite inside the reviewed isolated Docker container:

```sh
sh backend/scripts/run_study_sustained_load.sh
```

Raw JSON telemetry is saved at [`docs/evidence/study-sustained-load-20261118.json`](study-sustained-load-20261118.json).
