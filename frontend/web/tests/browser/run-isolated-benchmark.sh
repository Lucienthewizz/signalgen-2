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
PREFLIGHT="${WORKSPACE_DIR}/frontend/web/tests/browser/storage_benchmark_preflight.py"
DOCKER=(docker --context "${DOCKER_CONTEXT}")
CONTAINER_NAME="signalgen-storage-bench-$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')"

echo "==> Inspecting pinned image ${IMAGE_ID} on context ${DOCKER_CONTEXT}..."
image_json="$("${DOCKER[@]}" image inspect "${IMAGE_ID}")"
printf '%s' "${image_json}" | python3 "${PREFLIGHT}" image --expected-id "${IMAGE_ID}" --expected-platform "${PLATFORM}"
python3 "${PREFLIGHT}" deps --node-modules "${NODE_MODULES}" --package-lock "${WORKSPACE_DIR}/frontend/web/package-lock.json"
python3 "${PREFLIGHT}" sources --root "${WORKSPACE_DIR}" \
  frontend/web/src/analysis/signal-study-storage.ts \
  frontend/web/tests/fixtures/signal-study-storage.baseline.ts \
  frontend/web/tests/browser/study-storage-benchmark.mjs \
  frontend/web/package-lock.json

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/storage-bench-stage-XXXXXX")"
TMP_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/storage-bench-out-XXXXXX")"
cleanup() {
  "${DOCKER[@]}" rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
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
python3 "${PREFLIGHT}" run --timeout "${TIMEOUT_SECONDS}" -- "${DOCKER[@]}" run --rm \
  --name "${CONTAINER_NAME}" \
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
  env -i HOME=/tmp NODE_PATH=/work/node_modules PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  timeout --kill-after=10 "${TIMEOUT_SECONDS}" \
  node /work/app/tests/browser/study-storage-benchmark.mjs paired-benchmark > "${TMP_OUTPUT}"

mv "${TMP_OUTPUT}" "${OUTPUT_FILE}"
echo "==> Benchmark completed. Saved to ${OUTPUT_FILE}."
