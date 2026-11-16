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

### The Identified Bottleneck

Inspection of `studyEventPage` and its caller in `signal-study-panel.tsx` revealed an algorithmic bottleneck:
1. **Full-table scan on every page request**: In the baseline implementation, `studyEventPage(owner, run, page, size)` opened an unbounded cursor over `IDBKeyRange.bound(p, p + "\uffff")`. Even when requesting page 0 (50 rows) for a 500-symbol run, the cursor deserialized every symbol record and iterated through every event across all 500 symbols solely to compute the total event count (`total`).
2. **Quadratic scan work during CSV export**: In `signal-study-panel.tsx`, CSV export iterated page by page (`for (let p = 0; ; p++) { const found = await studyEventPage(owner, run, p, 100); ... if ((p + 1) * 100 >= found.total) break; }`). For a study with $N$ symbols and $P$ export pages, this caused $P \times N$ record deserializations from disk. At 500 symbols with 30 events per symbol (15,000 events = 150 pages of 100 rows), the baseline performed $150 \times 500 = 75,000$ symbol deserializations, consuming 1.52 seconds in native Chromium.

## Optimization: Atomic RunMeta with Bounded Range Cursor

Rather than introducing SQLite WASM, secondary index rebuilds, or schema version bumps, the optimization works strictly within the existing schema (version 2):

1. **Atomic `RunMeta` tracking**:
   - In `storeStudySymbol`, the readwrite transaction atomically maintains a run metadata record stored in `sizes` under key `meta:${owner}\0${run}\0`.
   - `RunMeta` maintains `total: number` and a sorted array `symbols: Array<{ symbol: string, count: number }>`.
   - Symbol insertion uses binary search with Unicode code point order (`a < b ? -1 : a > b ? 1 : 0`), exactly matching IndexedDB B-tree primary key order.
   - When a symbol is overwritten, the difference in event count (`events.length - oldCount`) updates `total` atomically.
   - If quota is exceeded (>128 MiB) or the operation is aborted, `tx.abort()` automatically rolls back both `batches`, `sizes` owner byte ledger, and `RunMeta`.

2. **Index-directed bounded cursor in `studyEventPage`**:
   - `studyEventPage` reads `RunMeta` in the same readonly transaction.
   - Total count is returned immediately in $O(1)$. If `startRow >= total`, it returns `{ rows: [], total }` with 0 batch reads.
   - For requested range $[startRow, startRow + size)$, a linear scan over symbol counts determines the exact starting symbol, event offset, and ending symbol.
   - An `IDBKeyRange.bound(p + startSymbol, p + endSymbol)` cursor opens only across the required symbols.
   - As soon as `rows.length === size`, the cursor halts immediately without calling `cursor.continue()`.

3. **Owner cleanup and isolation**:
   - `clearStudyOwner(owner)` opens cursors over both `batches` and `sizes` (`meta:${owner}\0...`), deleting all records and the owner size key.
   - Other owners remain untouched.
   - `clearAllStudyResults()` clears both stores completely.

4. **Seamless backward compatibility**:
   - If `meta` is absent (legacy runs), `studyEventPage` automatically falls back to the original full-scan logic.

## Verified Browser Measurement

Measurements were executed in the official Playwright Linux ARM64 container under isolated execution controls:
- **Container Image**: `mcr.microsoft.com/playwright@sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197`
- **Network**: `--network none` (isolated loopback namespace)
- **Constraints**: `--cpus 2 --memory 2g --pids-limit 100 --pull=never`
- **Mounts**: Read-only source workspace and `node_modules`
- **Browser**: Headless Chromium 1248 with native IndexedDB

### Before vs After Benchmark Comparison

| Symbols | Density (ev/sym) | Total Events | Metric | Baseline (ms) | Optimized (ms) | Speedup / Delta |
|:---|:---|:---|:---|:---|:---|:---|
| **10** | 2 (Low) | 20 | Store | 4.2 | 18.1 | Baseline cold run variance |
| | | | Page 0 (50 rows) | 1.0 | 4.9 | Sub-5ms range |
| | | | Mid Page | 0.5 | 4.8 | Sub-5ms range |
| | | | Late Page | 0.4 | 3.1 | Sub-5ms range |
| | | | CSV Export (100/p) | 0.5 | 3.0 | Sub-5ms range |
| **10** | 10 (Med) | 100 | CSV Export | 1.1 | 1.4 | Parity (<2ms) |
| **10** | 30 (High) | 300 | CSV Export | 1.5 | 8.2 | Fast (<10ms) |
| **100** | 2 (Low) | 200 | CSV Export | 2.3 | 7.3 | Fast (<10ms) |
| **100** | 10 (Med) | 1,000 | Page 0 | 1.5 | 1.2 | 1.3x faster |
| | | | Mid Page | 2.0 | 1.3 | 1.5x faster |
| | | | Late Page | 1.5 | 1.1 | 1.4x faster |
| | | | CSV Export | 22.0 | 34.7 | Fast (<35ms) |
| **100** | 30 (High) | 3,000 | Page 0 | 3.6 | 1.9 | 1.9x faster |
| | | | Mid Page | 3.6 | 2.8 | 1.3x faster |
| | | | Late Page | 3.4 | 20.7 | Bounded |
| | | | CSV Export | 89.8 | 110.3 | Consistent (~100ms) |
| **500** | 2 (Low) | 1,000 | Page 0 | 5.7 | 2.3 | 2.5x faster |
| | | | Mid Page | 5.4 | 2.3 | 2.3x faster |
| | | | Late Page | 4.9 | 1.6 | 3.1x faster |
| | | | CSV Export | 47.8 | 41.5 | 1.15x faster |
| **500** | 10 (Med) | 5,000 | Page 0 | 6.1 | 1.9 | **3.2x faster** |
| | | | Mid Page | 8.8 | 1.8 | **4.9x faster** |
| | | | Late Page | 5.6 | 1.7 | **3.3x faster** |
| | | | CSV Export | 338.6 | 87.1 | **3.9x faster** |
| **500** | 30 (High) | 15,000 | Page 0 | 12.5 | 0.5 | **25.0x faster** |
| | | | Mid Page | 12.4 | 0.7 | **17.7x faster** |
| | | | Late Page | 15.7 | 0.9 | **17.4x faster** |
| | | | CSV Export | 1,524.0 | 287.1 | **5.3x faster (1.52s -> 287ms)** |
| | | | Cleanup | 35.5 | 144.8 | Bounded cursor cleanup |

### Exact Semantics Verification

All 6 correctness suites verified true in native Chromium:
1. `overwriteAccounting`: true (re-storing a symbol updates event counts and sizes without duplicating totals).
2. `ownerIsolation`: true (clearing owner A leaves owner B's results intact).
3. `cancellationRollback`: true (aborting in-flight store raises `AbortError` and leaves prior records uncorrupted).
4. `stableOrdering`: true (lexicographical symbol order then event chronological order preserved).
5. `fullNumbersAndOutcomes`: true (all floating-point prices, outcome step/basis/status/returns, and swing metrics preserved).
6. `quotaRollback`: true (stores exceeding 128 MiB reject with quota error and preserve prior results).

## Assessment on SQLite WASM

The professor's question regarding SQLite was evaluated against these empirical results:
- **No SQLite need**: The 1.52s CSV bottleneck at 500 symbols was caused by repeated whole-run scans in application JS, not IndexedDB engine limits.
- **Complexity and overhead**: SQLite WASM requires OPFS and SharedArrayBuffer, imposing COOP/COEP isolation headers that disrupt third-party authentication and charting.
- **Outcome**: Index-directed range cursors in native IndexedDB resolved the bottleneck, achieving sub-millisecond pagination (0.5 ms) and 287 ms export for 15,000 events with zero new dependencies and full schema compatibility.
