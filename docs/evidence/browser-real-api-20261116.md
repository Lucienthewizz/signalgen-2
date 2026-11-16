# Real Browser UI + WASM + IndexedDB to Packaged API Verification — 16 November 2026

The complete browser-to-real-API journey passes on branch `frontend/prof-browser-real-api`, started from `baf888ac34e7afaa7d8495e4adfc40a4ddc23a9a`.

The verification connects the real React browser client, Web Worker/Go WebAssembly runtime, and native IndexedDB to the actual packaged Go API binary running against a disposable PostgreSQL database. Only the upstream identity provider and price history are synthetic fixtures; all product API authorization, rule storage, dataset content serving, compute grants, private scoring decisions, and WASM evaluations are real. No API routes are mocked or fulfilled by test intercepts.

Structured run metadata and assertions are recorded in [browser-real-api-20261116.json](browser-real-api-20261116.json). The operational guide is documented in [BROWSER_REAL_API_VERIFICATION.md](../backend/BROWSER_REAL_API_VERIFICATION.md).

## Executed Stack & Container Controls

| Component | Pinned Identity / Digest | Isolation & Resource Controls |
| --- | --- | --- |
| Go API Binary | `sha256:d4a008edc07e48837b4784a5e1be1f806bd4b8bc522f6704412719c6506f6d02` (`signalgen-local-runtime:baf888ac34e7`) | Linux/arm64, UID `10001:10001`, `--read-only`, 2 CPUs, 1 GB RAM, 128 PIDs, `--cap-drop ALL`, `--security-opt no-new-privileges`, private tmpfs `/scratch` |
| Disposable PostgreSQL | `sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1` (`postgres:17`) | Linux/arm64, UID `999:999`, `--read-only`, owns `network-none` loopback namespace, 2 CPUs, 1 GB RAM, 128 PIDs, `--cap-drop ALL` |
| Isolated Go Toolchain | `sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61` (`golang:1.27.2-bookworm`) | Linux/arm64, UID `65534:65534`, 2 CPUs, 2 GB RAM, 128 PIDs, `--cap-drop ALL`, offline compiler only |
| Official Playwright Browser | `sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197` (`mcr.microsoft.com/playwright:v1.64.1-noble`) | Linux/arm64, UID `1001:1001` (`pwuser`), `--read-only`, 2 CPUs, 2 GB RAM, 256 PIDs, `--cap-drop ALL`, `--security-opt no-new-privileges`, private bounded `/dev/shm` 256 MB (no `ipc=host`), private tmpfs `/scratch/output` (no host output mount) |

All containers share the disposable PostgreSQL container's `network-none` loopback namespace (`--network container:...`). No host ports are published (`-p` is prohibited). No host output directory is mounted; screenshots and reports are written to private container tmpfs and exported via stdout archive under parent verification. No Docker socket, personal credentials, cloud tokens, or ambient environment files enter any container. All runs use `--pull=never` under context `orbstack` after inspecting image IDs, architecture (`arm64`), and verifying zero `OnBuild` hooks.

## User Journey & Verification Results

59 explicit assertions (20 HTTP assertions, 39 browser UI/storage assertions) and 187 network requests executed across the real stack. The recorded run was built from clean commit `d746e4c`:

1. **Pre-flight & Database Initialization**:
   - Four coordinator-approved Linux ARM64 packages verified against `package-lock.json` (`c27cd5cbed7490dbd4d92c4e558bdf5dac976e0013ecd49a80627aca21117063`) and safely extracted into a bounded temporary dependency snapshot without lifecycle scripts.
   - `signalgen_core.wasm` (`af366a24c478003595dc5d47e126544d74d32412bcc6486632d40bc679b57c51`), matching `wasm_exec.js`, and `signalgen_core.manifest.json` compiled inside the Go container and verified with `verify_wasm_boundary.sh`.
   - Latest frontend built offline inside the Playwright container (`vite build`).
   - `schematest` applied 14 active database migrations and passed 3 security policy checks on a fresh database `signalgen_test`.
   - `bootstrap` seeded disposable operator `stack-0@test.invalid` (Pro subscription) and subscriber `stack-1@test.invalid`, alongside 23 synthetic catalog entries.
   - `collection.Sync` generated 23 daily price histories in an immutable published store mounted read-only at `/store`.

2. **Real Go API Owner Isolation**:
   - Owner 0 created real rule `Synthetic rising EMA` (`rule_18b6c31e640748ce2d3cf2ab`, hash `sha256:042fad7ed869c3f7ecb215af2d090b173a133aed5925a457842734af33171678`).
   - Foreign owner 1 reading owner 0's rule received HTTP 404 `RESOURCE_NOT_FOUND`.
   - Session mismatch probe (owner 1 bearer with owner 0 session token) received HTTP 403 `SESSION_REVOKED`.

3. **Real UI Login**:
   - Chromium in the Playwright container navigated to `http://127.0.0.1:5174/#login`.
   - User entered credentials for `stack-0@test.invalid` with `fixture-password-only`.
   - Client submitted login to the real Go API (`POST /api/auth/login`), created an app session (`POST /api/v1/sessions`), and navigated to `#app/overview`.
   - Storage confirmed valid session tokens in `sessionStorage`.

4. **Historical Screening & Outcome Boundary**:
   - Desktop viewport (1440x1000) in Dark theme.
   - User selected Entire IDX catalog (23 stocks) and rule `Synthetic rising EMA`.
   - Period: `2026-01-20` to `2026-01-23`.
   - Clicked "Start screening"; 3 dynamic batches processed (10, 10, 3 stocks).
   - 12 matching stocks and 11 non-matching stocks dynamically evaluated by the real API.
   - Exactly 48 matching BUY signals found (12 stocks × 4 trading days).
   - **Boundary Verified**: The screening results table displayed "Matching stocks and signal dates" with explicit user notice that returns are evaluated separately in Backtest. No auto outcomes, win rates, or return percentages were exposed prior to backtest evaluation.
   - Mobile viewport (390x844) in Dark theme verified responsive layout and deterministic Stop action (cancels immediately, stop button becomes disabled, zero late rows over 600ms, and UI restart re-enabled).

5. **Actual API Private Evaluation, Go/WASM & IndexedDB**:
   - Desktop viewport (1440x1000) in Light theme.
   - User navigated to `/#app/backtest`, selected the saved rule, Entire IDX catalog, and Target evaluation method (5% Take Profit).
   - Clicked "Start signal study".
   - The Go API created the study context (`POST /api/v1/backtests/studies`), served dataset series, created compute grants (`POST /api/v1/compute-grants`), and evaluated candidate features (`POST /api/v1/backtests/signals`).
   - Web Worker loaded `signalgen_core.wasm` and computed outcomes using `RunSignalStudy`.
   - Exact Target-hit statistics verified: `0.00% · 0/48 evaluated · 0 incomplete` (exact 0/48 denominator, 0 incomplete, 0.00%).
   - Results were stored in native IndexedDB (`signalgen-study-temporary-1`) under owner 0's partition across 23 symbol records and 48 signals.
   - Signal details table displayed all 48 evaluated rows.
   - Clicked "Export signal details CSV", successfully downloading `signal-study-events.csv` with 481 canonical lines (1 header + 480 outcome rows across 3 steps × 3 bases [open, high, close] + 1 swing for 48 signals).
   - Exact full CSV parsed rows comparison verified cell-by-cell against deterministic IndexedDB expanded tuple projection (symbol, signal_time, direction, reference_close, horizon, basis, status, price, return_pct, currency `IDR`, policy `signal-close-independent-1`, catalog_hash consistency, duplicate coverage, and order).
   - Browser observed response bytes for `/wasm/signalgen_core.wasm`, `/wasm/wasm_exec.js`, and `/wasm/signalgen_core.manifest.json` with exact SHA-256 and byte counts verified against dist outputs and Go build artifacts without API mocking.

6. **Capacity Control & Recovery**:
   - A concurrent study context creation correctly returned HTTP 429 `STUDY_CAPACITY`.
   - Calling `DELETE /api/v1/backtests/studies/:id` released the handle (HTTP 204).
   - Subsequent retry study context creation immediately returned HTTP 201 without stale locks or orphaned resources.
   - Cleanup deleted the retry study context (HTTP 204) and confirmed deletion with HTTP 404.

## Integrity, Manifests & Sandbox State

- **Chromium Sandbox Truthful Reporting**:
  `chromium.launch({ headless: true })` runs inside an unprivileged container with `chromium_internal_sandbox: false` and `os_container_isolation_enforced: true`. Playwright's default headless mode inside unprivileged user namespaces does not enable Chromium's internal zygote sandbox (which requires nested user namespaces or SUID sandbox helpers); strict OS-level container isolation is enforced instead (`cap-drop ALL`, `no-new-privileges`, readonly rootfs, private `/dev/shm` 256MB, non-root user `1001:1001`). No privileges were broadened or false sandbox strings invented.
- **Frontend Source & Built Asset Manifests**:
  Structured metadata in [browser-real-api-20261116.json](browser-real-api-20261116.json) records:
  - Exact tracked frontend source file hashes (all 133 tracked web files), HEAD commit, and dirty state.
  - Test runner hashes for allowlisted test runner and scenario files.
  - Dependencies identity: lockfile SHA-256 (`c27cd5cbed7490dbd4d92c4e558bdf5dac976e0013ecd49a80627aca21117063`), Playwright version `1.64.1`, and 4 SRI-verified Linux packages (`esbuild`, `rollup`, `@tailwindcss/oxide`, `lightningcss`).
  - Dist asset manifest: all 103 files in `dist/` with exact SHA-256 and byte counts.
  - WASM runtime identity: Go compiler outputs, `dist/` assets, and browser-loaded network response bytes match identically (`af366a24c478003595dc5d47e126544d74d32412bcc6486632d40bc679b57c51`).
- **Bounded Input Validation & Strict Tar Extraction**:
  - Web source files validated before copy: regular files only, no symlinks, safe relative paths, per-file size <= 16MB, cumulative <= 64MB.
  - Allowlisted test files: only `real-api-study.runner.mjs` and `real-api-study.scenario.js` mounted to `/tests`.
  - Dist tar extractor enforces bounded strict regular file extraction, rejecting symlinks, hardlinks, directory traversal, duplicate members, and oversize archives.
  - WASM boundary script verified with positive, missing required marker, and forbidden marker fixture tests.
  - CSV canonical equality comparator verified with negative mutation unit probes (price, return_pct, status, duplication, and row count mismatch).

## Visual Evidence

- Desktop Dark Screening: [browser-real-api-desktop-dark-screening.png](browser-real-api-desktop-dark-screening.png)
- Mobile Dark Screening: [browser-real-api-mobile-dark-screening.png](browser-real-api-mobile-dark-screening.png)
- Desktop Light Backtest: [browser-real-api-desktop-light-backtest.png](browser-real-api-desktop-light-backtest.png)
- Mobile Light Backtest: [browser-real-api-mobile-light-backtest.png](browser-real-api-mobile-light-backtest.png)

## Scope & Limitations

- The market history (23 stocks) and identity provider (HS256 mock) are synthetic fixtures; no live IDX exchange or Supabase production network traffic was accessed.
- Built distribution assets correspond to an offline, isolated Linux container build using the four approved, SRI-verified Linux ARM64 packages. No unapproved packages or lifecycle scripts were executed.
- Does not represent a 1000-user concurrent production load test.
