#!/usr/bin/env bash
set -euo pipefail

# Reproducible isolated runner for study storage browser benchmarks
# Uses verified local Playwright Linux ARM64 image with offline loopback, non-root user, dropped capabilities, and allowlisted read-only mounts.

IMAGE_ID="sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197"
WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
REAL_NODE_MODULES="/Users/lucienyudistirapurnawarman/Documents/Kuliah/signalgen-2/signalgen-2/frontend/web/node_modules"
STAGE_DIR="$(mktemp -d /tmp/storage-bench-stage-XXXXXX)"
OUTPUT_FILE="${WORKSPACE_DIR}/docs/evidence/study-storage-paired-20261116.json"

cleanup() {
  rm -rf "${STAGE_DIR}"
}
trap cleanup EXIT

echo "==> Staging allowlisted read-only input snapshot..."
mkdir -p "${STAGE_DIR}/src/analysis"
mkdir -p "${STAGE_DIR}/tests/fixtures"
mkdir -p "${STAGE_DIR}/tests/browser"

cp "${WORKSPACE_DIR}/frontend/web/src/analysis/signal-study-storage.ts" "${STAGE_DIR}/src/analysis/"
cp "${WORKSPACE_DIR}/frontend/web/tests/fixtures/signal-study-storage.baseline.ts" "${STAGE_DIR}/tests/fixtures/"
cp "${WORKSPACE_DIR}/frontend/web/tests/browser/study-storage-benchmark.mjs" "${STAGE_DIR}/tests/browser/"
cp "${WORKSPACE_DIR}/frontend/web/package-lock.json" "${STAGE_DIR}/"

echo "==> Executing benchmark in offline isolated container..."
docker run --rm \
  --pull=never \
  --network none \
  --user 1001:1001 \
  --security-opt=no-new-privileges:true \
  --cap-drop=ALL \
  --cpus 2 \
  --memory 2g \
  --pids-limit 100 \
  -v "${REAL_NODE_MODULES}:/work/node_modules:ro" \
  -v "${STAGE_DIR}:/work/app:ro" \
  -e NODE_PATH=/work/node_modules \
  -w /work \
  "${IMAGE_ID}" \
  node /work/app/tests/browser/study-storage-benchmark.mjs paired-benchmark > "${OUTPUT_FILE}"

echo "==> Benchmark completed successfully. Saved to ${OUTPUT_FILE}."
