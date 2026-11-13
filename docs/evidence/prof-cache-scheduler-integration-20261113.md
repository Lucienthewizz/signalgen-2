# Scheduler and publication-aware cache integration

The candidate combines scheduler integration `f748de5`, cache implementation
`989db437` through merge `baf888ac`, and independent cache review `22c1a8ae`.
The review found no demonstrated new defect in its bounded scope; it is not
whole-app approval. Earlier API harness, cleanup fix and review commits remain
ancestors. No merge to the main/default branch is included.

## Fresh combined checks

All of the following passed on combined product source `baf888ac`:

| Check | Result |
| --- | --- |
| Go regression | Collection, marketdata, dataset, API tests, collector CLI and API command packages pass. |
| Go race | Collection, marketdata, dataset and API test packages pass. |
| Go vet | Those packages plus the study handlers and CLI/API commands pass. |
| Python preflight/fault tests | Nine tests pass in the pinned offline Python sandbox. |
| Local package | Five rebuilt binaries match their packaged bytes and root-owned 0555 modes. |
| Collector smoke | Actual packaged help/catalog validation, synthetic incremental publications, read-only store and prune dry-run pass. |
| Autonomous scheduler | Actual production-function one-minute timer completes two iterations with one synthetic provider fetch; no website/API/Yahoo request. |
| Filesystem/Compose | Non-root execution, denied root/catalog writes, missing-mount rejection and empty-env Compose checks pass. |
| Packaged API/Postgres replay | 240 HTTP assertions pass; restricted `signalgen_api` role, 14 migrations and three policy checks. |
| Screening/private scoring | 23 synthetic stocks across three batches, 12 matched/11 unmatched, 46 persisted real grants. |

The new Linux ARM64 local image is
`sha256:d4a008edc07e48837b4784a5e1be1f806bd4b8bc522f6704412719c6506f6d02`,
tagged `signalgen-local-runtime:baf888ac34e7`. Its 360 tracked compiler inputs
come from `baf888ac34e7afaa7d8495e4adfc40a4ddc23a9a`. Later review and documentation
commits leave those inputs byte-identical. Runtime and toolchain inputs retain
their pinned identities; exact hashes are in the [structured evidence](prof-cache-scheduler-integration-20261113.json).
The first regression launch contained a mistyped image digest and was rejected
before a container or test ran; the corrected pinned-image invocation passed.

## Actual API replay and reproduction boundary

`build_local_runtime.py` rebuilt and checked the image from combined source.
The existing API harness was replayed using a private validation copy with four
reviewed substitutions: the checkout ROOT, immutable API image ID, protected
source BASE and expected image-source label. The repository helper was not
rewritten, and the historical `25ea600`/older-image evidence remains unchanged.
Both image/base checks and current source hashing remained enforced.

This ran the actual packaged API and real PostgreSQL repositories, sessions,
grants and private scoring. Only the identity upstream and market input were
synthetic. The client computed features/outcomes with native Go, not a browser.
The replay also exercised ownership, session/grant expiry, rule-version
mismatch, busy/capacity rejection, release and cancel/retry. Its container cleanup
completed, using the integrated per-resource failure handling.

Backend execution used existing pinned images and modules, no external network,
read-only source/root/toolchain, scratch-only writes and explicit safe child
environments. The combined regression/race/vet container had two CPUs, 2 GiB RAM,
256 PIDs, 512 MiB per file, 2 GiB scratch and a 420-second wall limit. Python had
one CPU, 128 MiB RAM, 32 PIDs, 8 MiB per file, 16 MiB scratch and a 20-second child
deadline. The timer had two CPUs, 1536 MiB RAM, 128 PIDs, 128 MiB per file,
256 MiB scratch and a 90-second test deadline. API replay retained the existing
network-none shared-loopback namespace and resource controls. No Docker socket,
host credential directory or personal environment file entered target containers.

The independent cache reviewer additionally ran repeated native/race cases and
four probes for mid-request publication, warm invalid pointers, metadata reuse
and shared flight bounds/timeouts. See the
[review report](../backend/PUBLICATION_CACHE_INDEPENDENT_REVIEW.md).

## Reused evidence and remaining limits

Frontend product source, core, API handlers, dataset policy and migrations remain
identical to `25ea600`. Earlier 262 frontend tests, six browser suites and 29 core
golden comparisons are reused, not claimed rerun. The changed marketdata and
collection paths received fresh combined tests, a rebuilt image and an API replay.
No performance benchmark was rerun or production speedup/capacity established.

Subsequent `idx_store` cache requests see the newly selected publication without
waiting for TTL; in-flight requests and existing dataset handles retain their
data. Separate history calls select independently. Immutable private generations,
stable filesystem behavior and retention grace remain requirements; metadata
filesystem/mutex waits are outside the later fetch timeout.

No real catalog acquisition, live Yahoo/Supabase validation, host schedule
activation, browser-to-real-API run, original clean production-Dockerfile build,
premium integration or 1000-user proof is claimed. Existing healthy containers
and all other worktrees were preserved.
