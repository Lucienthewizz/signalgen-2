# Study Storage IndexedDB Measurement and Optimization

Status: Verified measurement and source optimization, 16 November 2026.  
Base commit: `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e`.  
Reviewed commit: `df92fc14a4637cca153b55a884731c1d0804a2b8`.  
Affected file: `frontend/web/src/analysis/signal-study-storage.ts`.  
Test & benchmark files: `frontend/web/tests/study-storage.test.cjs`, `frontend/web/tests/browser/study-storage-benchmark.mjs`, `frontend/web/tests/fixtures/signal-study-storage.baseline.ts`.  
Runner script: `frontend/web/tests/browser/run-isolated-benchmark.sh`.

Runner update (2026-11-16, closes final-review F1): the script now takes the dependency tree from `BENCH_NODE_MODULES` instead of a host path, checks that it contains `.package-lock.json` and logs its SHA-256, runs on an explicit `--context` (default `orbstack`) and `--platform linux/arm64`, checks the image platform before running, and adds a read-only root, a bounded `/tmp`, a file-size ulimit and a wall-clock timeout. Output goes to a temp file first, so a failed run does not overwrite the evidence. A rerun with the updated script (output kept outside the repo) passed every correctness check. At 15,000 events, CSV export went from 1284.8 ms to 75.5 ms and store from 138.5 ms to 174.7 ms. The checked-in paired JSON is still the recorded run.  
Evidence records: `docs/evidence/study-storage-paired-20261116.json`, `docs/evidence/study-storage-measurement-20261116.txt`.

## Context and Problem Statement

`signal-study-storage.ts` manages temporary study results in browser storage using IndexedDB database `signalgen-study-temporary-1` (version 2), configured with two object stores:
- `batches`: keyed by `keyPath: "key"` where `key = ${owner}\0${run}\0${symbol}`, storing compact outcome tuples to avoid repeating field keys across market symbols.
- `sizes`: tracking cumulative serialized byte usage per owner against the 128 MiB quota (`STUDY_STORAGE_LIMIT = 128 * 1024 * 1024`).

### The Identified Bottlenecks

Inspection of `studyEventPage` and its caller in `signal-study-panel.tsx` revealed two related performance bottlenecks in the baseline implementation:
1. **Full-table scan on every page request**: In the baseline implementation, `studyEventPage(owner, run, page, size)` opened an unbounded cursor over `IDBKeyRange.bound(p, p + "\uffff")`. Even when requesting page 0 (50 rows) for a 500-symbol run, the cursor deserialized every symbol record and iterated through every event across all 500 symbols solely to compute the total event count (`total`).
2. **Quadratic scan work during CSV export**: In `signal-study-panel.tsx`, CSV export iterated page by page (`for (let p = 0; ; p++) { const found = await studyEventPage(owner, run, p, 100); ... if ((p + 1) * 100 >= found.total) break; }`). For a study with $N$ symbols and $P$ export pages, this caused $P \times N$ record deserializations from disk. At 500 symbols with 30 events per symbol (15,000 events = 150 pages of 100 rows), the baseline performed $150 \times 500 = 75,000$ symbol deserializations, consuming approximately 1.57 seconds in native Chromium.

## Optimization: Atomic RunMeta with Bounded Range Cursor

The optimization operates strictly within the existing schema (version 2) without adding external database dependencies, secondary indexes, or schema migrations:

1. **Atomic `RunMeta` tracking with flat arrays**:
   - In `storeStudySymbol`, the readwrite transaction atomically maintains run metadata stored in `sizes` under key `meta:${owner}\0${run}\0`.
   - `RunMeta` maintains `total: number` and flat arrays `s: string[]` (sorted symbol names) and `c: number[]` (event counts).
   - Symbol insertion uses binary search with Unicode code point order (`a < b ? -1 : a > b ? 1 : 0`), exactly matching IndexedDB B-tree primary key order.
   - When a symbol is overwritten, the difference in event count (`events.length - oldCount`) updates `total` atomically.
   - **Legacy Run Initialization**: If metadata is absent (legacy runs where symbols exist without a metadata record), `storeStudySymbol` performs an atomic one-time scan of existing records in `batches` before writing `sizes.put(meta, mKey)`. This guarantees that pre-existing symbols (e.g. A and B) are retained and published when a new symbol (C) is stored.
   - If quota is exceeded (>128 MiB) or the operation is aborted, `tx.abort()` automatically rolls back `batches`, the owner size byte ledger, and `RunMeta`.

2. **Index-directed bounded cursor in `studyEventPage`**:
   - `studyEventPage` reads `RunMeta` in the same readonly transaction.
   - Total count is returned immediately in $O(1)$. If `startRow >= total`, it returns `{ rows: [], total }` with 0 batch reads.
   - For requested range $[startRow, startRow + size)$, a linear scan over symbol counts determines the exact starting symbol, event offset, and ending symbol.
   - An `IDBKeyRange.bound(p + startSymbol, p + endSymbol)` cursor opens only across the required symbols.
   - As soon as `rows.length === size`, the cursor halts immediately without calling `cursor.continue()`, allowing the transaction to complete cleanly.
   - **Resolution Timing & Failure Handling**: Promises resolve strictly on `tx.oncomplete` and reject on `tx.onerror` or `tx.onabort`.

3. **Owner cleanup and isolation**:
   - `clearStudyOwner(owner)` opens cursors over both `batches` and `sizes` (`meta:${owner}\0...`), deleting all records and the owner size key.
   - Other owners remain untouched.
   - `clearAllStudyResults()` clears both stores completely.

4. **Backward compatibility**:
   - If `meta` is absent and cannot be initialized, `studyEventPage` falls back to the original full-scan logic.

## Verified Browser Measurement

Measurements were executed in the official Playwright Linux ARM64 container under isolated execution controls:
- **Container Image Digest**: `sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197`
- **Container Image Tag**: `mcr.microsoft.com/playwright@sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197`
- **Network**: `--network none` (isolated loopback namespace)
- **User & Capabilities**: `--user 1001:1001 --security-opt=no-new-privileges:true --cap-drop=ALL`
- **Resource Constraints**: `--cpus 2 --memory 2g --pids-limit 100 --pull=never`
- **Mounts**: Read-only `node_modules` and allowlisted staging snapshot (`/work/app:ro`). Root workspace containing `.env` and untracked files was excluded from mounts.
- **Browser**: Headless Chromium 1248 with native Linux sandboxing enabled (NO `--no-sandbox`).
- **Methodology (Closing R1)**: Alternating paired runs (1 unrecorded warmup each, followed by 3 paired alternating iterations: B-C, C-B, B-C) executing against fresh databases in identical fixture and runner.

### Provenance Hashes
- **Candidate Commit**: `df92fc14a4637cca153b55a884731c1d0804a2b8`
- **Baseline Commit**: `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e`
- **Candidate Source SHA-256**: `43f81fd8f588db1b069caff664d88ffb9182601bbca848b313754e578300d2fb`
- **Baseline Source SHA-256**: `02d767b09aaf7d52c2eeb61ac886c8b51c53fa426a221691861463c3f7fef78c`
- **Benchmark Runner SHA-256**: `c1983732916833f6647d5008a5cc747a59a01f047e87886e60958476b7c609b6`
- **Unit Test Suite SHA-256**: `553a1a9e34e56eb6ddf56e9fef038b7dd1082c3c9ca338274198ffabebcb7e83`
- **Package Lockfile SHA-256**: `c27cd5cbed7490dbd4d92c4e558bdf5dac976e0013ecd49a80627aca21117063`

### Paired Benchmark Comparison (Medians & Ranges across 3 Alternating Runs)

| Symbols | Density (ev/sym) | Total Events | Metric | Baseline Median [Range] (ms) | Candidate Median [Range] (ms) | Speedup / Delta |
|:---|:---|:---|:---|:---|:---|:---|
| **10** | 2 (Low) | 20 | Store | 2.9 [2.7, 3.0] | 3.3 [2.6, 12.0] | +0.4 ms |
| | | | Page 0 (50 rows) | 0.7 [0.7, 0.7] | 0.4 [0.4, 0.6] | 1.75x faster |
| | | | Mid Page | 0.4 [0.4, 0.5] | 0.3 [0.3, 0.5] | 1.33x faster |
| | | | Late Page | 0.5 [0.4, 0.5] | 0.3 [0.3, 0.4] | 1.67x faster |
| | | | CSV Export (100/p) | 0.5 [0.4, 0.5] | 0.5 [0.3, 1.1] | Parity |
| | | | Cleanup | 1.0 [0.7, 1.0] | 1.0 [0.9, 1.1] | Parity |
| **10** | 10 (Med) | 100 | CSV Export | 0.4 [0.3, 0.7] | 0.6 [0.4, 0.7] | Sub-millisecond parity |
| **10** | 30 (High) | 300 | CSV Export | 1.4 [1.4, 1.7] | 1.6 [1.3, 2.0] | Sub-2ms parity |
| **100** | 2 (Low) | 200 | CSV Export | 2.4 [2.0, 2.5] | 2.3 [1.7, 4.3] | 1.04x faster |
| **100** | 10 (Med) | 1,000 | Page 0 | 2.1 [1.9, 3.5] | 0.6 [0.6, 0.7] | **3.5x faster** |
| | | | Mid Page | 2.5 [1.9, 3.1] | 0.5 [0.5, 0.6] | **5.0x faster** |
| | | | Late Page | 1.9 [1.8, 2.0] | 0.5 [0.4, 0.6] | **3.8x faster** |
| | | | CSV Export | 19.9 [17.3, 40.8] | 7.3 [6.3, 7.9] | **2.73x faster** |
| **100** | 30 (High) | 3,000 | Page 0 | 2.9 [2.8, 3.1] | 0.5 [0.5, 0.5] | **5.8x faster** |
| | | | Mid Page | 2.7 [2.6, 2.8] | 0.5 [0.5, 0.5] | **5.4x faster** |
| | | | Late Page | 2.6 [2.4, 2.7] | 0.6 [0.5, 0.6] | **4.33x faster** |
| | | | CSV Export | 79.3 [78.8, 84.5] | 21.4 [20.6, 22.6] | **3.71x faster** |
| **500** | 2 (Low) | 1,000 | Page 0 | 4.7 [4.3, 5.0] | 1.0 [0.9, 1.0] | **4.7x faster** |
| | | | Mid Page | 3.6 [3.4, 4.0] | 1.1 [1.0, 1.2] | **3.27x faster** |
| | | | Late Page | 3.4 [3.2, 3.6] | 0.9 [0.8, 0.9] | **3.78x faster** |
| | | | CSV Export | 35.3 [34.3, 43.0] | 12.4 [10.5, 19.3] | **2.85x faster** |
| **500** | 10 (Med) | 5,000 | Page 0 | 6.0 [5.9, 6.2] | 0.7 [0.6, 0.8] | **8.57x faster** |
| | | | Mid Page | 6.7 [6.1, 7.0] | 0.5 [0.5, 0.6] | **13.4x faster** |
| | | | Late Page | 5.5 [5.4, 5.8] | 0.6 [0.6, 0.6] | **9.17x faster** |
| | | | CSV Export | 270.3 [258.0, 294.4] | 34.8 [30.7, 43.6] | **7.77x faster** |
| | | | Store Trade-off | 163.5 [157.1, 168.0] | 204.1 [187.1, 300.0] | +40.6 ms (metadata tracking) |
| | | | Cleanup Trade-off | 43.8 [41.8, 45.2] | 45.0 [37.7, 56.5] | +1.2 ms (cursor over meta keys) |
| **500** | 30 (High) | 15,000 | Page 0 | 13.0 [12.6, 13.1] | 0.5 [0.4, 0.5] | **26.0x faster** |
| | | | Mid Page | 10.1 [10.0, 10.4] | 0.5 [0.4, 0.5] | **20.2x faster** |
| | | | Late Page | 9.6 [9.4, 10.1] | 0.4 [0.4, 0.5] | **24.0x faster** |
| | | | CSV Export | 1,569.9 [1497.7, 1696.6] | 101.6 [88.3, 101.9] | **15.45x faster (1.57s -> 101.6ms)** |
| | | | Store Trade-off | 188.8 [172.4, 277.3] | 191.6 [191.2, 222.4] | +2.8 ms |
| | | | Cleanup Trade-off | 39.0 [32.8, 41.5] | 40.1 [37.2, 44.5] | +1.1 ms (meta key deletion) |

### Store and Cleanup Trade-offs (Closing R3)
- **Store Throughput**: Storing records requires updating the atomic `RunMeta` record (sorted symbol array insertion and total event count) in addition to writing the symbol batch and owner size ledger. In mid-sized workloads (500 symbols / 10 events), store throughput measured 204.1 ms vs 163.5 ms (+40.6 ms trade-off); at 15,000 events, it measured 191.6 ms vs 188.8 ms (+2.8 ms delta).
- **Cleanup Overhead**: `clearStudyOwner` must open cursors over both `batches` and the owner's `sizes` metadata keys (`meta:${owner}\0...`), taking ~40.1 ms vs baseline ~39.0 ms (+1.1 ms).
- **Trade-off Evaluation**: In exchange for modest metadata maintenance during write and cleanup, read pagination achieves sub-millisecond query latency across all page depths (0.5 ms vs 13.0 ms), and CSV export latency decreases by up to 15.45x (from 1,569.9 ms to 101.6 ms for 15,000 events), eliminating the user-visible UI freeze during export.

### Exact Semantics, Concurrency, and Correctness Verification
All 12 correctness suites passed in native Chromium:
1. `overwriteAccounting`: PASS (re-storing a symbol updates event counts and sizes without duplicating totals).
2. `ownerIsolation`: PASS (clearing owner A leaves owner B's results intact).
3. `cancellationRollback`: PASS (both pre-flight and mid-transaction in-flight abort trigger `AbortError` and roll back uncommitted changes).
4. `legacyWriteRegression`: PASS (pre-existing symbols without metadata are collected atomically on write, preserving all symbols in pagination and CSV).
5. `singlePageConcurrentWriters`: PASS (concurrent writes on separate connections in the same page serialize cleanly without lost updates).
6. `twoPageSharedDbConcurrentDifferentSymbols`: PASS (R2: two pages in the same browser context and origin concurrently writing separate symbols verify complete rows, sorted metadata, and byte ledger).
7. `twoPageSharedDbConcurrentSameSymbolOverwrite`: PASS (R2: two pages concurrently overwriting the same symbol verify exactly 1 winning metadata entry, consistent row counts, and no byte ledger duplication).
8. `nativeReadonlyAbortErrorRejection`: PASS (R3: forced readonly transaction abort cleanly rejects `studyEventPage` with error rather than returning silently empty results).
9. `stableOrdering`: PASS (lexicographical symbol order then event chronological order preserved).
10. `fullNumbersAndOutcomes`: PASS (all floating-point prices, outcome step/basis/status/returns, and swing metrics preserved).
11. `quotaRollback`: PASS (exact 128 MiB boundary verified with atomic rollback).
12. `exactCanonicalEquality`: PASS
    - Oracle SHA-256: `ae0f70165a02abd6c9bb2c30662a3477947f9008aa03848d9d5c6162fecae5fe`
    - Paginated SHA-256: `ae0f70165a02abd6c9bb2c30662a3477947f9008aa03848d9d5c6162fecae5fe`
    - CSV Export SHA-256: `ae0f70165a02abd6c9bb2c30662a3477947f9008aa03848d9d5c6162fecae5fe`
    - All 80 heterogeneous events across 4 symbols, high-precision floats, null fields, and all 6 outcome statuses match the independent oracle bit-for-bit.

## Assessment on Storage Architecture

The decision to retain native IndexedDB rather than introducing SQLite WASM is supported by empirical findings:
- **Bottleneck Resolution**: The 1.57-second CSV export delay at 500 symbols was caused by application-level quadratic rescanning ($P \times N$), not by IndexedDB engine limitations.
- **Performance**: Index-directed bounded cursors reduced 15,000-event export to 101.6 ms and pagination queries to 0.5 ms without adding external dependencies, worker serialization layers, or custom compilation headers.
- **Architectural Simplicity**: Retaining IndexedDB version 2 preserves full backward compatibility with legacy study data, requires zero additional dependencies, and maintains reliable transactional atomicity across connections.
