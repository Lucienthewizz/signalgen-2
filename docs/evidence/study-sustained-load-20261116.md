# Sustained HTTP Signal-Study Workload Measurement Evidence — 16 November 2026

## Source Base and Environmental Controls

All tests and measurements were executed against the checked-out worktree on branch `frontend/prof-api-sustained`, continuing from commit `47839331d625c19f61b1a5db646ff14faf0958a5`.

| Item | Value / Identity |
| --- | --- |
| Measurement Date | 16 November 2026 (UTC timestamp: `2026-11-16T04:16:23Z`) |
| Worktree Branch | `frontend/prof-api-sustained` |
| Pinned Docker Image | `golang:1.27.2-bookworm` (`sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61`) |
| Container Platform | `linux/arm64` via `--context orbstack` with `--pull=never` |
| Container Constraints | `--network none`, `--read-only`, `--user 65534:65534`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--cpus 2`, `--memory 2048m`, `--pids-limit 128`, `--tmpfs /scratch:rw,exec,size=2147483648,mode=1777` |
| Source Snapshot | Disposable tracked-source archive exported via `git archive`, allowlist verified, stripped of `.env*` |
| Host Deadline | 180 s hard deadline managed via Python subprocess timeout |
| Preserved Services | Shared containers `signalgen-2-go-api-1` and `signalgen-2-backend-1` untouched |

## Workload Scope and Lifecycle Definition

Unlike the prior initial burst probe (which ran for 28..77 ms and only evaluated the first symbol of batch 0), this measurement executed a continuous sustained loop for >=5.0 seconds per tier. Every completed study lifecycle executed the complete sequence across all 3 batches (Batch 0: 10 stocks, Batch 1: 10 stocks, Batch 2: 3 stocks = 23 total stocks):

1. **Context Admission:** `POST /api/v1/backtests/studies` (32 active context ceiling).
2. **Batch 0 (10 stocks):** `POST .../batches/0/prepare` (reserves 10 snapshots).
3. **Dataset Content Fetch & Local Feature Computation:** `GET /api/v1/datasets/{id}/content` for each symbol.
4. **Grant Issuance:** `POST /api/v1/compute-grants` with owner and session binding.
5. **Signal Evaluation:** `POST /api/v1/backtests/signals` evaluated through `core.RunSignalStudy` verifying 4 deterministic SELL events per symbol (total 92 events across 23 stocks per whole study).
6. **Batch 0 Release:** `DELETE .../batches/0/prepare` (releases 10 snapshot slots).
7. **Batch 1 (10 stocks):** Prepare, evaluate 10 stocks, and release batch 1.
8. **Batch 2 (3 stocks):** Prepare, evaluate 3 stocks, and release batch 2.
9. **Context Deletion:** `DELETE .../backtests/studies/{id}` freeing the study context slot.

## Measurement Summary (>=5.0 s Sustained Per Tier)

| Metric | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Target Attempts** | 199 | 433 | 473 | 20,985 |
| **Initiated Attempts** | 199 | 433 | 473 | 20,985 |
| **Completed Whole Studies** | 199 | 433 | 453 | 399 |
| **Capacity Rejected (429)** | 0 | 0 | 20 | 20,586 |
| **Unexpected Failures** | 0 | 0 | 0 | 0 |
| **Cancelled** | 0 | 0 | 0 | 0 |
| **Observed Peak In-Flight Contexts** | 1 (limit 32) | 19 (limit 32) | 59 (shadow limit 32) | 74 (shadow limit 32) |
| **Observed Peak In-Flight Snapshots** | 10 (limit 128) | 100 (limit 128) | 126 (limit 128) | 126 (limit 128) |
| **Warmup Duration** | 24.77 ms | 124.26 ms | 2,125.28 ms | 2,125.49 ms |
| **Measured Sustained Duration** | 5,016.42 ms (5.02 s) | 5,060.81 ms (5.06 s) | 6,076.30 ms (6.08 s) | 6,114.24 ms (6.11 s) |
| **Throughput (Completed Studies/s)** | 39.67 | 85.56 | 74.55 | 65.26 |
| **Throughput (Total Attempts/s)** | 39.67 | 85.56 | 77.84 | 3,432.15 |
| **Payload Body Sent** | 62.24 MiB | 135.44 MiB | 141.84 MiB | 127.31 MiB |
| **Payload Body Received** | 62.80 MiB | 136.64 MiB | 143.12 MiB | 129.74 MiB |

> [!NOTE]
> Payload bytes reflect HTTP request and response message bodies only, excluding transport framing and HTTP headers.

### Stage Latencies (Milliseconds, p50 / p95 / p99)

| Stage | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Create Context** | 0.05 / 0.32 / 2.03 | 1.01 / 2.91 / 3.80 | 1.34 / 3.80 / 5.14 | 1.43 / 4.88 / 10.21 |
| **Prepare Batch** | 0.72 / 3.38 / 5.90 | 2.43 / 5.31 / 6.80 | 2.79 / 8.02 / 3,010.43 | 2.84 / 16.42 / 3,012.68 |
| **Evaluate Stock** | 7.38 / 14.45 / 17.90 | 40.99 / 52.15 / 57.34 | 47.18 / 62.39 / 86.97 | 44.31 / 131.79 / 227.31 |
| **Release Batch & Delete Context** | 0.02 / 0.18 / 2.31 | 1.03 / 3.09 / 3.89 | 1.25 / 3.61 / 5.07 | 1.39 / 5.35 / 12.02 |
| **Full Whole-Study Lifecycle** | 24.43 / 35.51 / 40.47 | 116.18 / 133.23 / 140.00 | 137.22 / 2,145.53 / 3,017.29 | 1.46 / 6.33 / 127.80 |

### Go Runtime Memory Consumption (Signed Dataless Underflow-Safe)

| Metric | Concurrency 1 | Concurrency 10 | Concurrency 30 | Concurrency 40 |
| --- | --- | --- | --- | --- |
| **Heap Alloc Before** | 1.19 MiB | 1.66 MiB | 2.26 MiB | 2.51 MiB |
| **Heap Alloc After** | 6.68 MiB | 14.80 MiB | 14.50 MiB | 12.80 MiB |
| **Heap Alloc Delta (Signed)** | +5.49 MiB | +13.14 MiB | +12.24 MiB | +10.29 MiB |
| **Cumulative Total Alloc** | 2,028.74 MiB | 4,451.64 MiB | 4,660.71 MiB | 4,772.48 MiB |
| **Heap Mallocs Delta** | 14,746,626 | 32,061,352 | 33,595,722 | 33,284,975 |
| **Heap Frees Delta** | 14,697,465 | 31,947,958 | 33,481,212 | 33,194,797 |
| **GC Cycles Delta** | 894 | 888 | 735 | 777 |

## Deterministic Invariants and Overload Verification

1. **Strict Partitioning:** Across all runs:
   $$\text{attempts} = \text{completed} + \text{rejected} + \text{failed} + \text{cancelled}$$
   Zero unexpected HTTP errors (`failed = 0`) and zero drops (`cancelled = 0`) occurred.
2. **Whole Study Verification:** Each of the 1,484 completed studies across all tiers processed all 23 stocks and verified exactly 92 SELL events (4 events per stock) against deterministic expectations.
3. **Capacity Rejection Compliance:**
   - At Concurrency 30, snapshot capacity hit the 128-slot ceiling, rejecting 20 requests with HTTP 429 `SNAPSHOT_CAPACITY` and `Retry-After: 1`.
   - At Concurrency 40, context capacity saturated the 32-context ceiling, rejecting 20,586 excess admission attempts with HTTP 429 `STUDY_CAPACITY` and `Retry-After: 60`.
4. **Immediate Recovery Probe:** Retrying batch preparation after releasing a held batch succeeded immediately. Creating a study context after cancelling an active context succeeded without server restart.
5. **Simultaneous 32-Context Leak Proof:** Following the load tiers, the test suite simultaneously admitted 32 concurrent fresh study contexts, confirmed that context 33 was rejected (HTTP 429), prepared 12 batches simultaneously (120 snapshots held, 13th batch rejected), and verified that deleting all 32 contexts returned the dynamic snapshot store to 0 active snapshots.
6. **Isolated Store Measurement:** Each tier started with an independent test server and store instance, preventing cumulative snapshot or context peak carry-over across tiers.

## Synthetic Fixture Disclosures and Test Scope Boundaries

- **Synthetic Grant Storage:** Compute grants were tracked using a concurrent in-memory store verifying owner and session tokens. No persistent PostgreSQL database or production grant verification was evaluated.
- **Synthetic Dependencies:** Identity, session verification, access entitlements, and market daily OHLCV prices were provided by synthetic in-memory fixtures.
- **Local Loopback Only:** All HTTP requests were executed over local in-memory loopback (`net/http/httptest`). These measurements do not represent live production network conditions, external Yahoo/Supabase availability, or 1,000 concurrent user production capacity.
