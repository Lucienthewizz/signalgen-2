# Sustained HTTP Signal-Study Workload Measurement Evidence — 16 November 2026

## Source Base and Environmental Controls

All tests and measurements were executed against the checked-out worktree on branch `frontend/prof-api-sustained`, continuing from commit `58766cb23f539d9ece6583aad25744a1e5c52fd8`.

| Item | Value / Identity |
| --- | --- |
| Measurement Date | 16 November 2026 (UTC timestamp: `2026-11-16T04:35:51Z`) |
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
| **Target Attempts** | 206 | 279 | 409 | 464 |
| **Initiated Attempts** | 206 | 279 | 409 | 464 |
| **Completed Whole Studies** | 206 | 279 | 393 | 438 |
| **Capacity Rejected (429)** | 0 | 0 | 16 | 26 |
| **Unexpected Failures** | 0 | 0 | 0 | 0 |
| **Cancelled** | 0 | 0 | 0 | 0 |
| **Peak Admitted Contexts** | 1 (limit 32) | 10 (limit 32) | 30 (limit 32) | 32 (limit 32) |
| **Peak In-Flight Snapshots** | 10 (limit 128) | 100 (limit 128) | 126 (limit 128) | 126 (limit 128) |
| **Warmup Duration** | 50.87 ms | 112.39 ms | 2,095.98 ms | 2,107.04 ms |
| **Measured Sustained Duration** | 5,015.20 ms (5.02 s) | 5,071.23 ms (5.07 s) | 6,166.71 ms (6.17 s) | 6,156.73 ms (6.16 s) |
| **Throughput (Completed Studies/s)** | 41.08 | 55.02 | 63.73 | 71.14 |
| **Throughput (Total Attempts/s)** | 41.08 | 55.02 | 66.32 | 75.36 |
| **Payload Body Sent** | 64.43 MiB | 87.27 MiB | 122.94 MiB | 137.01 MiB |
| **Payload Body Received** | 65.00 MiB | 88.04 MiB | 124.04 MiB | 138.25 MiB |

> [!NOTE]
> Payload bytes reflect HTTP request and response message bodies only, excluding transport framing and HTTP headers.
> Peak admitted contexts represent real server-admitted active contexts tracked via admitted-only instrumentation. At Concurrency 40, peak admitted contexts reached exactly 32 (the enforced ceiling).

### Stage Latencies (Milliseconds, p50 / p95 / p99)

| Stage | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Create Context** | 0.05 / 0.17 / 1.23 | 1.44 / 6.27 / 9.11 | 1.19 / 4.70 / 6.84 | 1.37 / 4.35 / 7.34 |
| **Prepare Batch (10 symbols)** | 0.70 / 2.91 / 5.03 | 3.28 / 10.73 / 22.84 | 2.93 / 12.19 / 3,025.49 | 2.67 / 9.73 / 3,016.05 |
| **Evaluate Stock (Single stock)** | 0.54 / 2.93 / 5.36 | 5.36 / 15.74 / 36.51 | 5.15 / 12.55 / 20.29 | 4.97 / 10.31 / 15.72 |
| **Evaluate Batch (10 stocks)** | 6.72 / 14.45 / 18.85 | 46.25 / 111.05 / 224.03 | 48.64 / 89.55 / 140.69 | 44.12 / 78.73 / 106.11 |
| **Release & Delete Context** | 0.02 / 0.26 / 1.08 | 1.30 / 5.39 / 11.54 | 1.26 / 4.63 / 7.76 | 1.28 / 4.24 / 6.85 |
| **Attempt Latency (All attempts)** | 23.36 / 36.19 / 45.24 | 158.39 / 369.43 / 471.46 | 151.20 / 2,132.45 / 3,033.06 | 139.25 / 2,111.91 / 3,021.84 |
| **Completed Whole Study Lifecycle** | 23.36 / 36.19 / 45.24 | 158.39 / 369.43 / 471.46 | 151.12 / 1,129.41 / 2,138.03 | 137.46 / 1,135.09 / 2,112.11 |

### Go Runtime Memory Consumption (Signed Dataless Underflow-Safe)

| Metric | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Heap Alloc Before** | 1.23 MiB | 1.64 MiB | 2.14 MiB | 2.46 MiB |
| **Heap Alloc After** | 6.10 MiB | 12.51 MiB | 18.64 MiB | 10.35 MiB |
| **Heap Alloc Delta (Signed)** | +4.87 MiB | +10.87 MiB | +16.49 MiB | +7.89 MiB |
| **Cumulative Total Alloc** | 2,098.35 MiB | 2,867.95 MiB | 4,043.82 MiB | 4,502.92 MiB |
| **Heap Mallocs Delta** | 15,341,107 | 20,755,384 | 29,257,878 | 32,595,062 |
| **Heap Frees Delta** | 15,295,189 | 20,663,676 | 29,118,916 | 32,515,993 |
| **GC Cycles Delta** | 859 | 545 | 529 | 557 |

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
