# Sustained HTTP Signal-Study Workload Measurement Evidence — 16 November 2026

## Source Base and Environmental Controls

All tests and measurements were executed against the checked-out worktree on branch `frontend/prof-api-sustained` at commit `49c2a7805be2c93462e3dad05113defb70d51c66`.

| Item | Value / Identity |
| --- | --- |
| Measurement Date | 16 November 2026 (UTC timestamp: `2026-11-16T04:51:47Z`) |
| Worktree Branch | `frontend/prof-api-sustained` |
| Pinned Docker Image | `golang:1.27.2-bookworm` (`sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61`) |
| Container Platform | `linux/arm64` via `--context orbstack` with `--pull=never` |
| Container Constraints | `--network none`, `--read-only`, `--user 65534:65534`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--cpus 2`, `--memory 2048m`, `--pids-limit 128`, `--tmpfs /scratch:rw,exec,size=2147483648,mode=1777` |
| Source Snapshot | Verified tracked-source archive (388 tracked regular files, 2,261,562 bytes, manifest hash `bbdf1094f0745bcd`), allowlist checked with `os.lstat` regular-file enforcement, no symlinks, stripped of `.env*` |
| Host Deadline | 180 s hard deadline managed via Python subprocess timeout |
| Preserved Services | Shared containers `signalgen-2-go-api-1` and `signalgen-2-backend-1` untouched |

## Workload Scope and Lifecycle Definition

The measurement executed a continuous sustained closed-loop client workload for $\ge 5.0\text{ seconds}$ per tier. Every completed study lifecycle executed the complete sequence across all 3 batches (Batch 0: 10 stocks, Batch 1: 10 stocks, Batch 2: 3 stocks = 23 total stocks):

1. **Context Admission:** `POST /api/v1/backtests/studies` (32 active context ceiling).
2. **Batch 0 (10 stocks):** `POST .../batches/0/prepare` (reserves 10 snapshots).
3. **Dataset Content Fetch & Local Feature Computation:** `GET /api/v1/datasets/{id}/content` for each symbol.
4. **Grant Issuance:** `POST /api/v1/compute-grants` with owner and session binding.
5. **Signal Evaluation:** `POST /api/v1/backtests/signals` evaluated through `core.RunSignalStudy`, verified against canonical deterministic fixture oracle (4 SELL events per symbol, 92 events across 23 stocks per whole study).
6. **Batch 0 Release:** `DELETE .../batches/0/prepare` (releases 10 snapshot slots).
7. **Batch 1 (10 stocks):** Prepare, evaluate 10 stocks, and release batch 1.
8. **Batch 2 (3 stocks):** Prepare, evaluate 3 stocks, and release batch 2.
9. **Context Deletion:** `DELETE .../backtests/studies/{id}` freeing the study context slot.

## Measurement Summary (>=5.0 s Sustained Per Tier)

| Metric | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Target Attempts** | 222 | 703 | 657 | 570 |
| **Initiated Attempts** | 222 | 703 | 657 | 570 |
| **Completed Whole Studies** | 222 | 703 | 643 | 542 |
| **Capacity Rejected (429)** | 0 | 0 | 14 | 28 |
| **Unexpected Failures** | 0 | 0 | 0 | 0 |
| **Cancelled** | 0 | 0 | 0 | 0 |
| **Peak Admitted Contexts** | 1 (limit 32) | 10 (limit 32) | 30 (limit 32) | 32 (limit 32) |
| **Peak In-Flight Snapshots** | 10 (limit 128) | 100 (limit 128) | 126 (limit 128) | 126 (limit 128) |
| **Warmup Duration** | 35.15 ms | 84.44 ms | 2,113.24 ms | 2,124.11 ms |
| **Measured Sustained Duration** | 5,004.99 ms (5.00 s) | 5,026.83 ms (5.03 s) | 6,084.22 ms (6.08 s) | 7,078.41 ms (7.08 s) |
| **Throughput (Completed Studies/s)** | 44.36 | 139.85 | 105.68 | 76.57 |
| **Throughput (Total Attempts/s)** | 44.36 | 139.85 | 107.98 | 80.53 |
| **Payload Body Sent** | 69.44 MiB | 219.91 MiB | 201.15 MiB | 169.55 MiB |
| **Payload Body Received** | 70.06 MiB | 221.85 MiB | 202.94 MiB | 171.07 MiB |

> [!NOTE]
> Payload bytes reflect HTTP request and response message bodies only, excluding transport framing and HTTP headers.
> Peak admitted contexts represent real server-admitted active contexts tracked via admitted-only instrumentation. At Concurrency 40, peak admitted contexts reached exactly 32 (the enforced ceiling).

### Stage Latencies (Milliseconds, p50 / p95 / p99)

| Stage | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Create Context** | 0.04 / 0.14 / 0.82 | 0.61 / 1.76 / 2.37 | 0.90 / 2.76 / 4.41 | 1.09 / 3.15 / 5.08 |
| **Prepare Batch (10 symbols)** | 0.61 / 2.05 / 4.41 | 1.43 / 3.09 / 4.31 | 1.91 / 5.32 / 2,008.71 | 2.26 / 7.00 / 3,012.58 |
| **Evaluate Stock (Single stock)** | 0.44 / 2.45 / 5.25 | 2.68 / 4.29 / 5.16 | 3.47 / 6.62 / 10.36 | 4.02 / 8.52 / 11.43 |
| **Evaluate Batch (10 stocks)** | 5.61 / 11.53 / 15.53 | 25.47 / 31.30 / 33.75 | 31.92 / 54.95 / 72.52 | 35.10 / 64.69 / 79.03 |
| **Release & Delete Context** | 0.02 / 0.10 / 1.10 | 0.65 / 1.72 / 2.43 | 0.88 / 2.41 / 3.96 | 1.00 / 3.19 / 5.06 |
| **Attempt Latency (All attempts)** | 19.34 / 29.50 / 33.72 | 71.19 / 79.77 / 86.92 | 90.19 / 1,112.46 / 3,013.98 | 112.89 / 2,191.62 / 3,020.06 |
| **Rejected Admission Latency** | — | — | — | 2.82 / 2.99 / 2.99 |
| **Rejected Batch Latency** | — | — | 3,013.65 / 3,015.59 / 3,015.59 | 3,019.33 / 3,059.21 / 3,063.62 |
| **Completed Whole Study Lifecycle** | 19.34 / 29.50 / 33.72 | 71.19 / 79.77 / 86.92 | 89.88 / 175.75 / 2,080.49 | 110.89 / 198.48 / 2,192.17 |

### Go Runtime Memory Consumption (Signed Dataless Underflow-Safe)

| Metric | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Heap Alloc Before** | 1.04 MiB | 1.60 MiB | 2.39 MiB | 2.57 MiB |
| **Heap Alloc After** | 7.42 MiB | 21.92 MiB | 22.67 MiB | 22.82 MiB |
| **Heap Alloc Delta (Signed)** | +6.38 MiB | +20.32 MiB | +20.28 MiB | +20.25 MiB |
| **Cumulative Total Alloc** | 2,256.76 MiB | 7,219.58 MiB | 6,608.52 MiB | 5,573.66 MiB |
| **Heap Mallocs Delta** | 16,535,014 | 52,334,999 | 47,832,519 | 40,338,554 |
| **Heap Frees Delta** | 16,470,862 | 52,157,604 | 47,661,737 | 40,163,609 |
| **GC Cycles Delta** | 838 | 964 | 721 | 626 |

## Deterministic Invariants and Overload Verification

1. **Strict Outcome Partitioning:** Across all runs:
   $$\text{attempts} = \text{completed} + \text{rejected} + \text{failed} + \text{cancelled}$$
   Zero unexpected HTTP errors (`failed = 0`) and zero drops (`cancelled = 0`) occurred.
2. **Deterministic Oracle Validation:** Every completed study verified 23 distinct symbols and 92 SELL events matching canonical timestamps and prices ($191.0\dots 194.0$ after 90-day lookback).
3. **Closed-Loop Backoff Compliance:** When clients encountered HTTP 429 backpressure, they parsed `Retry-After`. If the required wait exceeded the remaining tier budget, the worker terminated cleanly rather than continuously hammering the endpoint.
4. **Post-Tier Full Capacity and Zero Leak Proof:** Following every single measured tier, the suite verified that:
   - Dynamic store active snapshots equaled 0.
   - 32 fresh retained contexts were concurrently admitted (and attempt 33 was rejected with HTTP 429 `STUDY_CAPACITY`, `Retry-After: 60`).
   - 12 batches were simultaneously prepared (120 snapshots held, and batch 13 was rejected with HTTP 429 `SNAPSHOT_CAPACITY`, `Retry-After: 1`).
   - All 32 contexts were deleted with HTTP 204.
   - Store active snapshots returned to 0.
5. **Mid-Lifecycle Fault Cleanup & Capacity Recovery (R1):** Table-driven fault injection across 5 mid-lifecycle failure stages (`prepare_500`, `content_500`, `grant_500`, `signals_500`, and `batch_release_500`) confirmed that every mid-lifecycle error terminates with `outcomeFailed`, preserves the underlying error, triggers deferred context deletion, leaves 0 active context leaks and 0 active snapshot leaks in `monitoredDynamicStore`, and fully passes subsequent fresh capacity reservation without degradation (`assertFullCapacityAndZeroLeaks`).
6. **Rejected Latency Separation (R2):** Explicit latency tracking separates immediate admission rejections (HTTP 429 `STUDY_CAPACITY`, ~2.82 ms p50) from batch snapshot capacity exhaustion (HTTP 429 `SNAPSHOT_CAPACITY`, ~3,019 ms p50 following client closed-loop backoff retry exhaustion).

## Synthetic Fixture Disclosures and Test Scope Boundaries

- **Synthetic Grant Storage:** Compute grants were tracked using a concurrent in-memory store verifying owner and session tokens. No persistent PostgreSQL database or production grant verification was evaluated.
- **Synthetic Dependencies:** Identity, session verification, access entitlements, and market daily OHLCV prices were provided by synthetic in-memory fixtures.
- **Local Loopback Only:** All HTTP requests were executed over local in-memory loopback (`net/http/httptest`). These measurements do not represent live production network conditions, external Yahoo/Supabase availability, or 1,000 concurrent user production capacity.
