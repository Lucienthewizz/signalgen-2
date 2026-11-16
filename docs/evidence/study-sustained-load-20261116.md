# Sustained HTTP Signal-Study Workload Measurement Evidence — 16 November 2026

## Source Base and Environmental Controls

All tests and measurements were executed against the checked-out worktree on branch `frontend/prof-api-sustained` at commit `d8a36cb3fdfae97085dd2ce8d83c41429182931a`.

| Item | Value / Identity |
| --- | --- |
| Measurement Date | 16 November 2026 (UTC timestamp: `2026-11-16T04:39:03Z`) |
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
| **Target Attempts** | 259 | 698 | 703 | 460 |
| **Initiated Attempts** | 259 | 698 | 703 | 460 |
| **Completed Whole Studies** | 259 | 698 | 687 | 434 |
| **Capacity Rejected (429)** | 0 | 0 | 16 | 26 |
| **Unexpected Failures** | 0 | 0 | 0 | 0 |
| **Cancelled** | 0 | 0 | 0 | 0 |
| **Peak Admitted Contexts** | 1 (limit 32) | 10 (limit 32) | 30 (limit 32) | 32 (limit 32) |
| **Peak In-Flight Snapshots** | 10 (limit 128) | 100 (limit 128) | 126 (limit 128) | 126 (limit 128) |
| **Warmup Duration** | 37.94 ms | 77.82 ms | 2,096.87 ms | 2,133.86 ms |
| **Measured Sustained Duration** | 5,011.09 ms (5.01 s) | 5,039.86 ms (5.04 s) | 6,175.12 ms (6.18 s) | 6,219.06 ms (6.22 s) |
| **Throughput (Completed Studies/s)** | 51.69 | 138.50 | 111.25 | 69.79 |
| **Throughput (Total Attempts/s)** | 51.69 | 138.50 | 113.84 | 73.97 |
| **Payload Body Sent** | 81.01 MiB | 218.34 MiB | 214.91 MiB | 135.76 MiB |
| **Payload Body Received** | 81.73 MiB | 220.27 MiB | 216.83 MiB | 136.99 MiB |

> [!NOTE]
> Payload bytes reflect HTTP request and response message bodies only, excluding transport framing and HTTP headers.
> Peak admitted contexts represent real server-admitted active contexts tracked via admitted-only instrumentation. At Concurrency 40, peak admitted contexts reached exactly 32 (the enforced ceiling).

### Stage Latencies (Milliseconds, p50 / p95 / p99)

| Stage | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Create Context** | 0.04 / 0.14 / 1.35 | 0.63 / 1.75 / 2.29 | 0.90 / 2.01 / 2.85 | 1.25 / 3.85 / 7.97 |
| **Prepare Batch (10 symbols)** | 0.61 / 2.15 / 4.25 | 1.45 / 3.22 / 4.22 | 1.79 / 4.96 / 2,038.24 | 2.49 / 11.95 / 3,011.19 |
| **Evaluate Stock (Single stock)** | 0.41 / 2.42 / 5.02 | 2.69 / 4.35 / 5.16 | 3.36 / 5.77 / 10.96 | 4.22 / 10.45 / 30.57 |
| **Evaluate Batch (10 stocks)** | 5.28 / 11.48 / 14.68 | 25.84 / 31.29 / 33.88 | 31.58 / 41.20 / 152.16 | 37.64 / 88.25 / 315.81 |
| **Release & Delete Context** | 0.02 / 0.11 / 1.72 | 0.66 / 1.76 / 2.40 | 0.86 / 2.48 / 4.23 | 1.02 / 3.89 / 9.53 |
| **Attempt Latency (All attempts)** | 18.15 / 28.99 / 32.22 | 71.73 / 79.65 / 83.62 | 88.47 / 1,480.49 / 3,011.82 | 115.28 / 2,182.60 / 3,020.24 |
| **Completed Whole Study Lifecycle** | 18.15 / 28.99 / 32.22 | 71.73 / 79.65 / 83.62 | 88.28 / 668.63 / 2,153.76 | 114.74 / 1,126.96 / 2,183.71 |

### Go Runtime Memory Consumption (Signed Dataless Underflow-Safe)

| Metric | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Heap Alloc Before** | 1.22 MiB | 1.60 MiB | 2.25 MiB | 2.37 MiB |
| **Heap Alloc After** | 9.51 MiB | 12.61 MiB | 26.27 MiB | 17.70 MiB |
| **Heap Alloc Delta (Signed)** | +8.29 MiB | +11.01 MiB | +24.02 MiB | +15.33 MiB |
| **Cumulative Total Alloc** | 2,633.33 MiB | 7,163.88 MiB | 7,055.47 MiB | 4,461.33 MiB |
| **Heap Mallocs Delta** | 19,290,227 | 51,959,454 | 51,111,950 | 32,305,497 |
| **Heap Frees Delta** | 19,216,870 | 51,843,451 | 50,908,933 | 32,214,513 |
| **GC Cycles Delta** | 977 | 964 | 764 | 550 |

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

## Synthetic Fixture Disclosures and Test Scope Boundaries

- **Synthetic Grant Storage:** Compute grants were tracked using a concurrent in-memory store verifying owner and session tokens. No persistent PostgreSQL database or production grant verification was evaluated.
- **Synthetic Dependencies:** Identity, session verification, access entitlements, and market daily OHLCV prices were provided by synthetic in-memory fixtures.
- **Local Loopback Only:** All HTTP requests were executed over local in-memory loopback (`net/http/httptest`). These measurements do not represent live production network conditions, external Yahoo/Supabase availability, or 1,000 concurrent user production capacity.
