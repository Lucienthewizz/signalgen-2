# Study Storage IndexedDB Measurement and Optimization

Status: Verified measurement and source optimization, 16 November 2026.  
Base commit: `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e`.  
Affected file: `frontend/web/src/analysis/signal-study-storage.ts`.  
Test & benchmark files: `frontend/web/tests/study-storage.test.cjs`, `frontend/web/tests/browser/study-storage-benchmark.mjs`.  
Evidence records: `docs/evidence/study-storage-baseline-20261116.json`, `docs/evidence/study-storage-optimized-20261116.json`, `docs/evidence/study-storage-measurement-20261116.txt`.

## Context and Problem Statement

`signal-study-storage.ts` manages temporary study results in browser storage using IndexedDB database `signalgen-study-temporary-1` (version 2), configured with two object stores:
- `batches`: keyed by `keyPath: "key"` where `key = ${owner}\0${run}\0${symbol}`, storing compact outcome tuples to avoid repeating field keys across market symbols.
- `sizes`: tracking cumulative serialized byte usage per owner against the 128 MiB quota (`STUDY_STORAGE_LIMIT = 128 * 1024 * 1024`).

### The Identified Bottlenecks

Inspection of `studyEventPage` and its caller in `signal-study-panel.tsx` revealed two related performance bottlenecks:
1. **Full-table scan on every page request**: In the baseline implementation, `studyEventPage(owner, run, page, size)` opened an unbounded cursor over `IDBKeyRange.bound(p, p + "\uffff")`. Even when requesting page 0 (50 rows) for a 500-symbol run, the cursor deserialized every symbol record and iterated through every event across all 500 symbols solely to compute the total event count (`total`).
2. **Quadratic scan work during CSV export**: In `signal-study-panel.tsx`, CSV export iterated page by page (`for (let p = 0; ; p++) { const found = await studyEventPage(owner, run, p, 100); ... if ((p + 1) * 100 >= found.total) break; }`). For a study with $N$ symbols and $P$ export pages, this caused $P \times N$ record deserializations from disk. At 500 symbols with 30 events per symbol (15,000 events = 150 pages of 100 rows), the baseline performed $150 \times 500 = 75,000$ symbol deserializations, consuming 1.52 seconds in native Chromium.

## Optimization: Atomic RunMeta with Bounded Range Cursor

Rather than introducing external database dependencies, secondary index rebuilds, or schema version bumps, the optimization works strictly within the existing schema (version 2):

1. **Atomic `RunMeta` tracking with compact flat arrays**:
   - In `storeStudySymbol`, the readwrite transaction atomically maintains run metadata stored in `sizes` under key `meta:${owner}\0${run}\0`.
   - `RunMeta` maintains `total: number` and flat arrays `s: string[]` (sorted symbol names) and `c: number[]` (event counts). Flat arrays reduce V8 structured clone serialization overhead by approximately 6x compared to arrays of objects (`{ symbol, count }`), ensuring store throughput parity.
   - Symbol insertion uses binary search with Unicode code point order (`a < b ? -1 : a > b ? 1 : 0`), exactly matching IndexedDB B-tree primary key order.
   - When a symbol is overwritten, the difference in event count (`events.length - oldCount`) updates `total` atomically.
   - **Legacy Run Initialization**: If metadata is absent (legacy runs where symbols exist without a metadata record), `storeStudySymbol` performs an atomic one-time scan of existing records in `batches` before writing `sizes.put(meta, mKey)`. This guarantees that pre-existing symbols (e.g. A and B) are retained and published when a new symbol (C) is stored.
   - If quota is exceeded (>128 MiB) or the operation is aborted, `tx.abort()` automatically rolls back both `batches`, the owner size byte ledger, and `RunMeta`.

2. **Index-directed bounded cursor in `studyEventPage`**:
   - `studyEventPage` reads `RunMeta` in the same readonly transaction.
   - Total count is returned immediately in $O(1)$. If `startRow >= total`, it returns `{ rows: [], total }` with 0 batch reads.
   - For requested range $[startRow, startRow + size)$, a linear scan over symbol counts determines the exact starting symbol, event offset, and ending symbol.
   - An `IDBKeyRange.bound(p + startSymbol, p + endSymbol)` cursor opens only across the required symbols.
   - As soon as `rows.length === size`, the cursor halts immediately without calling `cursor.continue()`, allowing the transaction to complete cleanly.
   - **Resolution Timing**: Promises resolve strictly on `tx.oncomplete` and reject on `tx.onerror` or `tx.onabort`, preventing dangling reads.

3. **Owner cleanup and isolation**:
   - `clearStudyOwner(owner)` opens cursors over both `batches` and `sizes` (`meta:${owner}\0...`), deleting all records and the owner size key.
   - Other owners remain untouched.
   - `clearAllStudyResults()` clears both stores completely.

4. **Seamless backward compatibility**:
   - If `meta` is absent and cannot be initialized, `studyEventPage` falls back to the original full-scan logic.

## Verified Browser Measurement

Measurements were executed in the official Playwright Linux ARM64 container under isolated execution controls:
- **Container Image**: `mcr.microsoft.com/playwright@sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197`
- **Network**: `--network none` (isolated loopback namespace)
- **User & Capabilities**: `--user 1001:1001 --security-opt=no-new-privileges:true --cap-drop=ALL`
- **Resource Constraints**: `--cpus 2 --memory 2g --pids-limit 100 --pull=never`
- **Mounts**: Read-only `node_modules` and allowlisted source staging directory (`/work/app:ro`). Root workspace containing `.env` and untracked files was excluded from mounts.
- **Browser**: Headless Chromium 1248 with native Linux sandboxing enabled (NO `--no-sandbox`).
- **Methodology**: 1 discarded warmup iteration followed by 3 paired timed iterations recording median and [min, max] range.

### Head-to-Head Benchmark Comparison

| Symbols | Density (ev/sym) | Total Events | Metric | Baseline (ms) | Optimized Median [Range] (ms) | Speedup / Delta |
|:---|:---|:---|:---|:---|:---|:---|
| **10** | 2 (Low) | 20 | Store | 4.2 | 3.1 [2.9, 3.9] | 1.35x faster |
| | | | Page 0 (50 rows) | 1.0 | 0.7 [0.7, 0.8] | 1.4x faster |
| | | | Mid Page | 0.5 | 0.7 [0.7, 0.7] | Sub-millisecond parity |
| | | | Late Page | 0.4 | 0.6 [0.6, 0.6] | Sub-millisecond parity |
| | | | CSV Export (100/p) | 0.5 | 0.5 [0.3, 0.7] | Parity |
| **10** | 10 (Med) | 100 | CSV Export | 1.1 | 0.8 [0.5, 0.9] | 1.4x faster |
| **10** | 30 (High) | 300 | CSV Export | 1.5 | 1.6 [1.3, 2.6] | Sub-2ms parity |
| **100** | 2 (Low) | 200 | CSV Export | 2.3 | 1.8 [1.8, 1.8] | 1.3x faster |
| **100** | 10 (Med) | 1,000 | Page 0 | 1.5 | 0.5 [0.4, 0.6] | **3.0x faster** |
| | | | Mid Page | 2.0 | 0.5 [0.5, 0.5] | **4.0x faster** |
| | | | Late Page | 1.5 | 0.5 [0.5, 0.5] | **3.0x faster** |
| | | | CSV Export | 22.0 | 6.7 [5.9, 6.9] | **3.3x faster** |
| **100** | 30 (High) | 3,000 | Page 0 | 3.6 | 0.4 [0.3, 0.4] | **9.0x faster** |
| | | | Mid Page | 3.6 | 0.4 [0.4, 0.4] | **9.0x faster** |
| | | | Late Page | 3.4 | 0.4 [0.4, 0.4] | **8.5x faster** |
| | | | CSV Export | 89.8 | 17.6 [16.3, 19.2] | **5.1x faster** |
| **500** | 2 (Low) | 1,000 | Page 0 | 5.7 | 0.9 [0.8, 1.0] | **6.3x faster** |
| | | | Mid Page | 5.4 | 0.9 [0.9, 0.9] | **6.0x faster** |
| | | | Late Page | 4.9 | 0.9 [0.9, 0.9] | **5.4x faster** |
| | | | CSV Export | 47.8 | 10.3 [8.2, 18.9] | **4.6x faster** |
| **500** | 10 (Med) | 5,000 | Page 0 | 6.1 | 0.6 [0.5, 0.7] | **10.2x faster** |
| | | | Mid Page | 8.8 | 0.7 [0.7, 0.7] | **12.6x faster** |
| | | | Late Page | 5.6 | 0.6 [0.6, 0.6] | **9.3x faster** |
| | | | CSV Export | 338.6 | 32.7 [30.5, 40.6] | **10.4x faster** |
| **500** | 30 (High) | 15,000 | Page 0 | 12.5 | 0.5 [0.4, 0.5] | **25.0x faster** |
| | | | Mid Page | 12.4 | 0.5 [0.5, 0.5] | **24.8x faster** |
| | | | Late Page | 15.7 | 0.5 [0.5, 0.5] | **31.4x faster** |
| | | | CSV Export | 1,524.0 | 90.1 [90.1, 98.5] | **16.9x faster (1.52s -> 90.1ms)** |
| | | | Store Throughput | 191.7 | 196.6 [182.0, 339.6] | Store throughput preserved |
| | | | Cleanup | 35.5 | 41.7 [38.8, 44.4] | Bounded cursor cleanup |

### Exact Semantics and Correctness Verification

All 9 correctness and regression suites passed verification in native Chromium:
1. `overwriteAccounting`: PASS (re-storing a symbol updates event counts and sizes without duplicating totals).
2. `ownerIsolation`: PASS (clearing owner A leaves owner B's results intact).
3. `cancellationRollback`: PASS (both pre-flight aborted signal and mid-transaction abort trigger `AbortError` and roll back uncommitted changes).
4. `legacyWriteRegression`: PASS (pre-existing symbols without metadata are collected atomically on write, preserving all symbols in pagination and CSV).
5. `concurrentWriters`: PASS (concurrent writes on separate symbols serialize cleanly without race conditions or lost updates).
6. `stableOrdering`: PASS (lexicographical symbol order then event chronological order preserved).
7. `fullNumbersAndOutcomes`: PASS (all floating-point prices, outcome step/basis/status/returns, and swing metrics preserved).
8. `quotaRollback`: PASS (stores exceeding 128 MiB reject with quota error and preserve prior results).
9. `exactCanonicalEquality`: PASS
   - Oracle SHA-256: `ae0f70165a02abd6c9bb2c30662a3477947f9008aa03848d9d5c6162fecae5fe`
   - Paginated SHA-256: `ae0f70165a02abd6c9bb2c30662a3477947f9008aa03848d9d5c6162fecae5fe`
   - CSV Export SHA-256: `ae0f70165a02abd6c9bb2c30662a3477947f9008aa03848d9d5c6162fecae5fe`
   - All 80 heterogeneous events across 4 symbols, high-precision floats, null fields, and all 6 outcome statuses match the independent oracle bit-for-bit.

## Assessment on SQLite WASM

The question of whether to replace or augment IndexedDB with SQLite WASM was evaluated against empirical measurements and browser storage architecture:

### Technical Constraints of SQLite WASM
- **OPFS VFS Modes & Concurrency**:
  - The standard SQLite `opfs` VFS relies on `FileSystemSyncAccessHandle`, which is available exclusively within dedicated WebWorkers. This model forbids synchronous access on the main thread and requires dedicated message-passing channels between React and the worker.
  - The `opfs-sahpool` VFS (Storage Access Handle Pool) allows file sharing across workers, but requires pre-allocating file capacity pools and introduces locking overhead that can delay quick queries.
  - Both OPFS models incur cross-context serialization overhead for every row batch transferred back to the UI thread.
- **COOP/COEP Headers**:
  - Utilizing `SharedArrayBuffer` for multithreaded WASM performance requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers, which can break third-party embeds, identity providers, and cross-origin chart assets.
- **Binary Footprint and Startup Cost**:
  - The SQLite WASM binary adds 800 KB to 1 MB of compressed assets that must be downloaded, compiled, and initialized before any study query can run.

### Native IndexedDB Advantages in SignalGen
- **Root Cause Resolution**: The 1.52-second CSV export bottleneck was caused entirely by application-level full-table rescanning ($P \times N$), not by underlying IndexedDB storage engine limitations.
- **Empirical Performance**: Index-directed bounded cursors reduced 15,000-event CSV export to 90.1 ms (16.9x speedup) and pagination queries to 0.5 ms (25x speedup), outperforming typical WASM-worker serialization boundaries.
- **Zero New Dependencies & Complete Compatibility**: The solution adds 0 KB in dependencies, requires no special HTTP response headers, preserves existing schema version 2, and seamlessly supports legacy data.
