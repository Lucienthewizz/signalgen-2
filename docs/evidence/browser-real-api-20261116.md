# Real Browser UI + WASM + IndexedDB to Packaged API Verification — 16 November 2026

The complete browser-to-real-API journey passes on branch `frontend/prof-browser-real-api`, started from `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e`.

The verification connects the real React browser client, Web Worker/Go WebAssembly runtime, and native IndexedDB to the actual packaged Go API binary running against a disposable PostgreSQL database. Only the upstream identity provider and price history are synthetic fixtures; all product API authorization, rule storage, dataset content serving, compute grants, private scoring decisions, and WASM evaluations are real. No API routes are mocked or fulfilled by test intercepts.

Structured run metadata and assertions are recorded in [browser-real-api-20261116.json](browser-real-api-20261116.json). The operational guide is documented in [BROWSER_REAL_API_VERIFICATION.md](../backend/BROWSER_REAL_API_VERIFICATION.md).

## Executed Stack & Container Controls

| Component | Pinned Identity / Digest | Isolation & Resource Controls |
| --- | --- | --- |
| Go API Binary | `sha256:d4a008edc07e48837b4784a5e1be1f806bd4b8bc522f6704412719c6506f6d02` (`signalgen-local-runtime:baf888ac34e7`) | Linux/arm64, UID `10001:10001`, `--read-only`, 2 CPUs, 1 GB RAM, 128 PIDs, `--cap-drop ALL`, `--security-opt no-new-privileges`, private tmpfs `/scratch` |
| Disposable PostgreSQL | `sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1` (`postgres:17`) | Linux/arm64, UID `999:999`, `--read-only`, owns `network-none` loopback namespace, 2 CPUs, 1 GB RAM, 128 PIDs, `--cap-drop ALL` |
| Isolated Go Toolchain | `sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61` (`golang:1.27.2-bookworm`) | Linux/arm64, UID `65534:65534`, 2 CPUs, 2 GB RAM, 128 PIDs, `--cap-drop ALL`, offline compiler only |
| Official Playwright Browser | `sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197` (`mcr.microsoft.com/playwright:v1.64.1-noble`) | Linux/arm64, UID `1001:1001` (`pwuser`), `--read-only`, 2 CPUs, 2 GB RAM, 256 PIDs, `--cap-drop ALL`, `--security-opt no-new-privileges`, private bounded `/dev/shm` 256 MB (no `ipc=host`) |

All containers share the disposable PostgreSQL container's `network-none` loopback namespace (`--network container:...`). No host ports are published (`-p` is prohibited). No Docker socket, personal credentials, cloud tokens, or ambient environment files are mounted into any container. All runs use `--pull=never` under context `orbstack` after inspecting image IDs, architecture (`arm64`), and verifying zero `OnBuild` hooks.

## User Journey & Verification Results

182 HTTP assertions and product requests executed across the real stack:

1. **Pre-flight & Database Initialization**:
   - `schematest` applied 14 active database migrations and passed 3 security policy checks on a fresh database `signalgen_test`.
   - `bootstrap` seeded disposable operator `stack-0@test.invalid` (Pro subscription) and subscriber `stack-1@test.invalid`, alongside 23 synthetic catalog entries.
   - `collection.Sync` generated 23 daily price histories in an immutable published store mounted read-only at `/store`.

2. **Real Go API Owner Isolation**:
   - Owner 0 created real rule `Synthetic rising EMA` (`rule_3960f39a0249a367900d75e0`, hash `sha256:042fad7ed869c3f7ecb215af2d090b173a133aed5925a457842734af33171678`).
   - Foreign owner 1 reading owner 0's rule received HTTP 404 `RESOURCE_NOT_FOUND`.
   - Session mismatch probe (owner 1 bearer with owner 0 session token) received HTTP 403 `SESSION_REVOKED`.

3. **Real UI Login**:
   - Chromium in the Playwright container navigated to `http://127.0.0.1:5174/#login`.
   - User entered credentials for `stack-0@test.invalid` with `fixture-password-only`.
   - Client submitted login to the real Go API (`POST /api/auth/login`), created an app session (`POST /api/v1/sessions`), and navigated to `#app/overview`.
   - Storage confirmed valid session tokens in `sessionStorage`.

4. **Historical Screening & Outcome Boundary**:
   - Desktop viewport (1440x1000) in Dark theme.
   - User selected Entire IDX catalog (23 stocks > 10) and rule `Synthetic rising EMA`.
   - Period: `2026-01-20` to `2026-01-23`.
   - Clicked "Start screening"; 3 batches processed (10, 10, 3 stocks).
   - 12 matching stocks and 11 non-matching stocks evaluated by the real API.
   - Exactly 48 matching BUY signals found (12 stocks × 4 trading days).
   - **Boundary Verified**: The screening results table displayed "Matching stocks and signal dates" with explicit user notice that returns are evaluated separately in Backtest. No auto outcomes, win rates, or return percentages were exposed prior to backtest evaluation.
   - Mobile viewport (390x844) in Dark theme verified responsive layout and Stop action.

5. **Actual API Private Evaluation, Go/WASM & IndexedDB**:
   - Desktop viewport (1440x1000) in Light theme.
   - User navigated to `/#app/backtest`, selected the saved rule, Entire IDX catalog, and Target evaluation method (5% Take Profit).
   - Clicked "Start signal study".
   - The Go API created the study context (`POST /api/v1/backtests/studies`), served dataset series (`GET /api/v1/datasets/:id/content`), created compute grants (`POST /api/v1/compute-grants`), and evaluated candidate features (`POST /api/v1/backtests/signals`).
   - Web Worker loaded `signalgen_core.wasm` (`f4ef8296a624fe73ef87675417760cea9677879dbb0f71ff679886c76c670ff6`) and computed outcomes using `RunSignalStudy`.
   - Results were stored in native IndexedDB (`signalgen-study-temporary-1`) under owner 0's partition.
   - Signal details table displayed all 48 evaluated rows.
   - Clicked "Export signal details CSV", successfully downloading `signal-study-events.csv` with 481 lines (48 signals across horizons plus header).

6. **Capacity Control & Recovery**:
   - A concurrent study context creation correctly returned HTTP 429 `STUDY_CAPACITY`.
   - Calling `DELETE /api/v1/backtests/studies/:id` released the handle.
   - Subsequent study context creation immediately returned HTTP 201 without stale locks or orphaned resources.

## Visual Evidence

- Desktop Dark Screening: [browser-real-api-desktop-dark-screening.png](browser-real-api-desktop-dark-screening.png)
- Mobile Dark Screening: [browser-real-api-mobile-dark-screening.png](browser-real-api-mobile-dark-screening.png)
- Desktop Light Backtest: [browser-real-api-desktop-light-backtest.png](browser-real-api-desktop-light-backtest.png)
- Mobile Light Backtest: [browser-real-api-mobile-light-backtest.png](browser-real-api-mobile-light-backtest.png)

## Scope & Limitations

- The market history (23 stocks) and identity provider (HS256 mock) are synthetic fixtures; no live IDX exchange or Supabase production network traffic was accessed.
- Built distribution assets correspond to clean git tree `e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e` (SHA-256 `2d4f131a...`). No full Linux build was run because host toolchain dependencies are darwin-arm64 only.
- Does not represent a 1000-user concurrent production load test.
