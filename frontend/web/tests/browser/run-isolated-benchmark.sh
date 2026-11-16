#!/usr/bin/env bash
set -euo pipefail

# Isolated runner for the study storage browser benchmarks.
# Uses the pinned Playwright Linux ARM64 image with no network, a non-root user,
# dropped capabilities, resource limits, and allowlisted read-only mounts.
#
# Required: BENCH_NODE_MODULES=<path to a Linux ARM64 node_modules tree for frontend/web>
# Optional: DOCKER_CONTEXT (default: orbstack), BENCH_TIMEOUT_SECONDS (default: 900),
#           BENCH_OUTPUT (default: docs/evidence/study-storage-paired-20261116.json)

IMAGE_ID="sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197"
PLATFORM="linux/arm64"
DOCKER_CONTEXT="${DOCKER_CONTEXT:-orbstack}"
TIMEOUT_SECONDS="${BENCH_TIMEOUT_SECONDS:-900}"
WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
NODE_MODULES="${BENCH_NODE_MODULES:?set BENCH_NODE_MODULES to a Linux ARM64 node_modules tree}"
OUTPUT_FILE="${BENCH_OUTPUT:-${WORKSPACE_DIR}/docs/evidence/study-storage-paired-20261116.json}"
DOCKER=(docker --context "${DOCKER_CONTEXT}")

if [[ ! -d "${NODE_MODULES}" || -L "${NODE_MODULES}" || ! -f "${NODE_MODULES}/.package-lock.json" ]]; then
  echo "BENCH_NODE_MODULES must be a real directory containing .package-lock.json: ${NODE_MODULES}" >&2
  exit 2
fi

echo "==> Inspecting pinned image ${IMAGE_ID} on context ${DOCKER_CONTEXT}..."
image_platform="$("${DOCKER[@]}" image inspect --format '{{.Os}}/{{.Architecture}}' "${IMAGE_ID}")"
if [[ "${image_platform}" != "${PLATFORM}" ]]; then
  echo "image platform is ${image_platform}, expected ${PLATFORM}" >&2
  exit 2
fi
image_entrypoint="$("${DOCKER[@]}" image inspect --format '{{json .Config.Entrypoint}} {{json .Config.OnBuild}}' "${IMAGE_ID}")"
echo "    platform=${image_platform} entrypoint/onbuild=${image_entrypoint}"
echo "    node_modules lock sha256=$(shasum -a 256 "${NODE_MODULES}/.package-lock.json" | cut -d' ' -f1)"

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/storage-bench-stage-XXXXXX")"
TMP_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/storage-bench-out-XXXXXX")"
cleanup() {
  rm -rf "${STAGE_DIR}" "${TMP_OUTPUT}"
}
trap cleanup EXIT

echo "==> Staging allowlisted read-only input snapshot..."
mkdir -p "${STAGE_DIR}/src/analysis" "${STAGE_DIR}/tests/fixtures" "${STAGE_DIR}/tests/browser"
cp "${WORKSPACE_DIR}/frontend/web/src/analysis/signal-study-storage.ts" "${STAGE_DIR}/src/analysis/"
cp "${WORKSPACE_DIR}/frontend/web/tests/fixtures/signal-study-storage.baseline.ts" "${STAGE_DIR}/tests/fixtures/"
cp "${WORKSPACE_DIR}/frontend/web/tests/browser/study-storage-benchmark.mjs" "${STAGE_DIR}/tests/browser/"
cp "${WORKSPACE_DIR}/frontend/web/package-lock.json" "${STAGE_DIR}/"

echo "==> Executing benchmark in offline isolated container (timeout ${TIMEOUT_SECONDS}s)..."
"${DOCKER[@]}" run --rm \
  --pull=never \
  --platform "${PLATFORM}" \
  --network none \
  --user 1001:1001 \
  --security-opt=no-new-privileges:true \
  --cap-drop=ALL \
  --read-only \
  --tmpfs /tmp:rw,size=512m \
  --shm-size 256m \
  --cpus 2 \
  --memory 2g \
  --pids-limit 100 \
  --ulimit fsize=268435456 \
  --stop-timeout 10 \
  -v "${NODE_MODULES}:/work/node_modules:ro" \
  -v "${STAGE_DIR}:/work/app:ro" \
  -e NODE_PATH=/work/node_modules \
  -e HOME=/tmp \
  -w /work \
  "${IMAGE_ID}" \
  timeout --kill-after=10 "${TIMEOUT_SECONDS}" \
  node /work/app/tests/browser/study-storage-benchmark.mjs paired-benchmark > "${TMP_OUTPUT}"

mv "${TMP_OUTPUT}" "${OUTPUT_FILE}"
echo "==> Benchmark completed. Saved to ${OUTPUT_FILE}."
