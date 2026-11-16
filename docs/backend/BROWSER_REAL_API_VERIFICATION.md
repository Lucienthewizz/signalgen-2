# Browser UI to Real Packaged API Verification Guide

This guide details the architecture, security isolation, and reproduction commands for verifying SignalGen's browser client, Web Worker/Go WASM engine, and native IndexedDB against the actual packaged Go API and a disposable PostgreSQL database.

## Architecture

The verification exercises the full browser-to-API pipeline with strict container network isolation:

```
+-----------------------------------------------------------------------------------------------------+
| Disposable PostgreSQL Container (Network-None Loopback Namespace)                                   |
|   - 127.0.0.1:5432: PostgreSQL (postgres:17)                                                       |
|                                                                                                     |
| Shared-Namespace Containers (--network container:<pg-container>):                                   |
|   - 127.0.0.1:9999: Mock IDP Stub (/tools/localstack identity)                                     |
|   - 127.0.0.1:8080: Actual Go API (/usr/local/bin/signalgen-api, signalgen-local-runtime:baf888ac)  |
|   - 127.0.0.1:5174: Node Fixture Server (serves dist/ static files & proxies /api to :8080)        |
|   - Chromium Headless: Playwright Browser (mcr.microsoft.com/playwright:v1.64.1-noble)             |
+-----------------------------------------------------------------------------------------------------+
```

No container publishes ports to the host (`-p` is prohibited). All inter-service communication occurs over loopback inside the disposable PostgreSQL container's network namespace.

## Pinned Container Images

| Role | Repository & Tag | Immutable Image Digest |
| --- | --- | --- |
| Packaged API | `signalgen-local-runtime:baf888ac34e7` | `sha256:d4a008edc07e48837b4784a5e1be1f806bd4b8bc522f6704412719c6506f6d02` |
| Database | `postgres:17` | `sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1` |
| Go Toolchain | `golang:1.27.2-bookworm` | `sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61` |
| Browser | `mcr.microsoft.com/playwright@sha256:f609973e...` | `sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197` |

Each image is inspected prior to execution to verify:
1. Exact match with the pinned SHA-256 digest.
2. Target architecture is Linux `arm64`.
3. Absence of `OnBuild` triggers.
4. Execution using `--pull=never`.

## Process & Security Isolation

- **File System**: Roots are mounted read-only (`--read-only`). Toolchain caches, test files, and built assets are mounted read-only. Writable paths are restricted to private, bounded tmpfs mounts (`/scratch:rw,exec,size=512m` and `/dev/shm:rw,exec,size=256m`).
- **Privileges**: Dropped capabilities (`--cap-drop ALL`), no privilege elevation (`--security-opt no-new-privileges`), and non-root execution (`1001:1001` for Playwright, `10001:10001` for API, `999:999` for PostgreSQL).
- **Environment**: Child processes run in sanitized environments using `env -i` with strict allowlists (`PATH`, `HOME`, `TMPDIR`, and `PLAYWRIGHT_BROWSERS_PATH`). No host credential directories, `.env` files, or Docker sockets enter any container.
- **Cleanup**: Container names are uniquely prefixed and tracked. On error, timeout, or completion, all containers are removed in reverse order using `docker rm -f`.

## Reproduction Commands

### 1. Preflight and Fault Tests

Run the offline unit tests verifying isolation flags, image inspection checks, archive unpack bounds, and container cleanup behavior:

```sh
python3 backend/scripts/test_browser_api_stack.py
```

### 2. Full Browser-to-Real-API Verification Stack

Execute the end-to-end journey in OrbStack:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/verify_browser_api_stack.py
```

This command will:
1. Inspect image digests and verify protected backend source hashes against base commit `baf888ac34e7afaa7d8495e4adfc40a4ddc23a9a`.
2. Compile and vet `localstack` and `schematest` inside the isolated Go container.
3. Build the synthetic 23-stock published archive.
4. Start disposable PostgreSQL, run 14 migrations and 3 policy checks, and bootstrap disposable Pro users `stack-0@test.invalid` and `stack-1@test.invalid`.
5. Launch the actual Go API and mock identity stub in the shared container namespace.
6. Launch the official Playwright container with headless Chromium:
   - Perform real UI login and establish an app session.
   - Screen historical signals across 23 stocks and verify no auto outcomes.
   - Run signal study evaluation with real Go/WASM computation and IndexedDB storage.
   - Assert owner isolation, capacity limiting (HTTP 429), and Stop/retry recovery.
   - Export and verify signal details CSV.
   - Capture desktop and mobile screenshots across light and dark themes.
7. Save evidence to `docs/evidence/browser-real-api-20261116.json` and copy screenshots to `docs/evidence/`.
8. Clean up all created containers and temporary directories.

## Associated Evidence

- Structured Evidence: [docs/evidence/browser-real-api-20261116.json](../evidence/browser-real-api-20261116.json)
- Acceptance Report: [docs/evidence/browser-real-api-20261116.md](../evidence/browser-real-api-20261116.md)
