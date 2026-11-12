# Professor revisions follow-up — 12 November 2026

All requested combined implementation checks passed. Exact runtime-image
verification and Linux unit syntax/activation remain unverified; the local
compiled-collector smoke below is separate evidence.

## Integrated source

The worktree was clean and fetched origin tips matched the specified commits:

| Source branch | Tip | History-preserving merge |
| --- | --- | --- |
| `frontend/local-storage-cache-plan` | `fffec6bc087f980b5a7b3eca894fed45cbcb8c74` | `50833a8a14691e826962c4975e63d095b18f3af1` |
| `frontend/target-hit-metrics` | `5ceb7057db305cf41364990d8448f4a249735a40` | `0b18235a92b8f2e09d04ec17672e0e9839c9750c` |
| `frontend/snapshot-capacity-control` | `cbcdfa3db92bd66a717e8e92934708b63a649e35` | `e2d43c0ad818f860b64f0e43614b0ee7b061f2a4` |

Starting integration tip was `757c7e6c338c7c875d3476a99f5270977c2f0efa`.
No merge conflicts occurred. Commit `79a3f00576934173ad42f44bc303489a9dd79513`
adds the bounded verification helpers and a two-part screening copy fix: expose
the existing retry wait and tell users to restart after partial processing;
when no stock was processed, show unavailable results instead of No matches.
No authorization, capacity bound, private rule, collector policy or dependency
changed in that fix. Main and the source branches/worktrees were preserved.

## Combined checks

| Check | Result |
| --- | --- |
| `npm test` | 262 passed; zero failed/skipped/cancelled |
| `npm run typecheck` | Passed |
| `npm run format:check` | Passed for all configured targets |
| `npm run build` | Passed, after complete merged-source WASM generation and before Vite tests |
| `npm run check:budgets` | Passed; entry JS gzip 96,905 B, workspace static JS gzip 163,754 B, entry CSS gzip 64,584 B |
| `npm run test:browser` | Passed, including EMA operands, workspace/history/CSV and session fixtures |
| `npm run test:market-screen` | Passed, real WASM/IndexedDB and existing partial/restart/Stop cases |
| `npm run test:study` | Passed, real WASM/IndexedDB and existing retry/CSV/quota/cancellation cases |
| `node tests/browser/evaluation-options.mjs` | Passed, all three evaluation modes and incomplete/SL-first semantics |
| `node tests/browser/target-hit-metrics.mjs` | Passed, weighted target counts, legacy unavailable, summary CSV and 50/14 paging |
| `node tests/browser/snapshot-overload.mjs` | Passed, eight fresh contexts: screen/study × 1440/390 × dark/forced light |
| Scoped browser syntax/format, shell syntax, gofmt and whitespace | Passed; one scoped runner formatting warning was corrected before commit |
| Isolated `go test ./core ./internal/dataset ./internal/api/tests -count=1` | Passed on combined source |
| Isolated `go test -race ./internal/dataset ./internal/api/tests -count=1` | Passed |
| Isolated `go vet ./core ./internal/dataset ./internal/api/backtests ./internal/api/tests` | Passed |

Browser commands ran from `frontend/web`, using this worktree's unused port
5181. Existing suites used the installed Playwright CLI wrapper; the new overload
runner uses the locked Playwright package directly. All used headless installed
Chrome and isolated contexts. General workspace coverage retains its dark-only
matrix; focused suites cover desktop/mobile forced dark/light styles. No build
ran during Vite/browser execution, and this worktree's Vite process was stopped.

The overload runner reuses existing synthetic API fixture setup, adds actual
HTTP 429 `SNAPSHOT_CAPACITY` with `Retry-After: 1`, and executes the real shared
client, app, worker, merged Go/WASM and IndexedDB. It verifies no scoring/storage
before admission, automatic recovery after simulated capacity release, exactly
three attempts per persistently refused batch, explicit restart/frozen retry,
keyboard Stop during the delay, no late requests or stale completion, empty
foreign-owner result reads and no page overflow. Screenshots of mobile/light and
desktop/dark waiting states were inspected. API/private decisions remain mocked;
the backend HTTP tests independently validate actual atomic reservation and
release. This is not a live end-to-end backend/provider run or a full accessibility
audit.

Matching WASM was built inside an isolated Go container from the merged source;
the runtime and manifest were generated together. The three named outputs were
size/type checked before copying them into the ignored public asset directory.
Public and production-build binary/runtime hashes match their manifests. The
manifest records WASM SHA-256
`a2f6872da1c5dfe5468cd4688a97a7401fae3c1dbb1a17a8c8e8587dee246d61`
and 5,278,529 bytes. No generated asset or build output is committed.

## IDX runtime: proven fallback

From the repository root:

```sh
sh backend/scripts/verify_idx_runtime_local.sh
```

The reusable script builds the merged collector, prints its digest, and runs
collection/CLI tests plus vet. The opt-in `TestCollectorRuntimeSmoke` exercises
the actual binary's help and synthetic `-validate-only`, creates five incremental
publications using the existing synthetic provider fixture, checks
`-prune-only -retention-dry-run` eligibility without deleting generations or
changing publication, and reads the store with non-writable directory/file modes.
All passed. No Yahoo request or real catalog was used.

Toolchain image identity:
`golang:1.27.2-bookworm` =
`sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61`.
Fallback compiled binary SHA-256:
`77d5ecd5ed145f21a8dc9a69ee75113a6807775a879db346bac6e79c3aef9449`.
This identifies a test binary, not an `api-runtime` image.

All new backend/WASM execution used Docker with network disabled, read-only
root/source/module cache/toolchain, no capabilities, no-new-privileges,
UID/GID 65534, and an `env -i` allowlist with scratch HOME/TMPDIR/GOCACHE and
offline module/toolchain settings. The affected API/race/vet run had 2 CPUs,
2 GiB RAM, 256 PIDs, a 2 GiB executable scratch tmpfs, 512 MiB per-file and
480-second wall limits. WASM/runtime fallback runs had 2 CPUs, 1536 MiB RAM,
128 PIDs, 1 GiB scratch, 128 MiB per-file and 180-second wall limits. Source files were read-only; host credential directories and Docker sockets
were not exposed inside the target-controlled container.

## Exact image and scheduler: needs validation

The actual [Go.Dockerfile](../../backend/Go.Dockerfile) copies
`signalgen-collect-idx` into `api-runtime`, sets non-root user 10001 and includes
the API healthcheck. Its source stage runs `go mod download`; the runtime stage
runs apt for CA certificates and user creation. Source inspection proves this
recipe, not a built image from the merged source.

An exact-image build was blocked at safety preflight, before executing any
Dockerfile RUN command. The inspected local Buildx interface provides networking,
resource and ulimit options, but a builder enforcing read-only target/root,
scratch-only writes, an explicit child environment and bounded writable-layer
disk/PIDs for every RUN was not established. The current recipe writes module
and system paths outside scratch. Cached downloader/apt layers suitable for an
offline exact build were also not established. No weaker build, daemon change,
dependency fetch or derived Dockerfile was substituted. **No exact runtime image
was built or smoked, and its image identity is unknown.**

Remaining procedure: provide an isolated builder that enforces all required
controls for the unmodified recipe with preseeded dependency/CA inputs; build
the exact merged `api-runtime` offline; record its immutable image ID; smoke the
non-root collector/help, synthetic validation and private read-only archive
serving in that image under the same bounded controls. The fallback above does
not satisfy this gate.

`systemd-analyze` is unavailable on the macOS host, so no Linux unit syntax pass
is claimed. Existing service/timer files were read only; neither was installed
or activated and no user/path was provisioned. They remain sample Linux units.
The optional `docker-compose.idx-history.yml` selects fixed `idx_archive` mode;
publication-aware `idx_store` needs an explicit target configuration and durable
store path. No environment file was inspected or changed.

## Remaining limits

Prior performance samples and the capacity worker's admission comparison were
not rerun; they remain attached to their original commits/environments. The
1000-wave result means 32 contexts admitted / 968 rejected, 12 complete batches /
20 whole-batch refusals and zero capacity-driven partial batches, with unchanged
bounds. It does not prove sustained fairness, speedup or 1000-user capacity.

Target rates are policy-resolved daily-candle statistics, not broker execution or
portfolio returns. Missing inputs remain deployment topology, premium API
specification/cost/licensing, actual IDX coverage/freshness and staging/device/
full-user-load proof. No cloud/production deployment, shared-provider load or
actual catalog download was performed.

[Structured results and source references](prof-revisions-followup-20261112.json).
