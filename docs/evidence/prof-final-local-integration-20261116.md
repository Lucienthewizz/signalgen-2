# Combined local verification — 16 November 2026

The reviewed worker changes are integrated on `frontend/prof-local-final-integration` with the user frontend base `38aba17`. The coordinator tested product source at `b79c58bd3188a366b02ad212d1e68e16474358da`; this follow-up changes evidence only.

The offline Linux ARM64 verification passed 280 frontend unit tests, TypeScript project checks, full source formatting, Vite build and performance budgets. Commands were `node --test tests/*.test.cjs`, `node node_modules/typescript/bin/tsc -b --pretty false`, `node node_modules/prettier/bin/prettier.cjs --check src vite.config.ts index.html`, `node node_modules/vite/bin/vite.js build`, and `node scripts/check-performance-budgets.mjs`.

Execution used the approved immutable Playwright image, an empty environment with an explicit safe allowlist, a non-root user, offline networking, read-only source/toolchain mounts, and private bounded scratch writes. Limits were 2 CPUs, 2 GiB memory, 128 processes, 1536 MiB scratch, a 128 MiB file-size limit, a 150-second inner deadline and a 165-second host deadline. Only the exact owned container was removed.

The initial attempts failed because the test copy omitted three backend fixture/contract inputs and Node resolved packages from a mount called `/deps`. A corrected repository layout and the `/toolchain/node_modules` mount resolved those failures. The coordinator reused local dependencies and the four approved, checksum-verified Linux packages without changing the project lockfile or installing further packages. The original failures are not product test passes.

The worker separately passed the combined browser-to-real-API journey with the packaged Go API, disposable PostgreSQL, rebuilt WASM and native IndexedDB. Its identity provider and price histories were fixtures. The coordinator's frontend build is additional validation; it does not replace the worker's matching WASM/runtime/manifest proof. Exact merged tips and the checks are recorded in [the structured integration evidence](prof-final-local-integration-20261116.json).

The historical paired storage benchmark is retained with its original source and environment attribution. It was not rerun by the coordinator. Current IDX catalog coverage, live five-year Yahoo acquisition, premium-provider details and production user capacity remain outside this local proof.

## Running screener endpoint repair

The user's running port-8080 API was still the older image `sha256:f1baf33b1e06c6a7b54f6226cf758785efd2efe99a358c9f613aa906da2077f4`, created on 10 November. Although the frontend and source used `/api/v1/screener/scans`, the running API returned HTTP 404 `RESOURCE_NOT_FOUND` and its OpenAPI document omitted the route.

Only the local Compose `go-api` service was recreated with the previously verified local runtime `sha256:d4a008edc07e48837b4784a5e1be1f806bd4b8bc522f6704412719c6506f6d02`. Existing environment configuration was retained. The local `signalgen-2-go-api:latest` tag was updated to the same image so a subsequent ordinary Compose start uses the restored runtime. No source files in the user's Midtrans checkout were changed.

Afterward the service was healthy, its OpenAPI document included both screening routes, and unauthenticated POST requests returned HTTP 401 `AUTH_REQUIRED` through both port 8080 and the frontend proxy on port 5174. This proves route availability and proxy routing; it does not claim that an authenticated full-market scan or live provider acquisition was run. The repair record is [screener-runtime-refresh-20261116.json](screener-runtime-refresh-20261116.json).
