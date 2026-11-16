#!/bin/sh
# Bounded offline Docker runner for sustained HTTP signal-study load measurements.
# Must be executed from repository root.
# Preserves shared host services and containers; runs in isolated loopback container.
set -eu

REPO_ROOT=$(pwd)
if [ ! -f "$REPO_ROOT/backend/go.mod" ]; then
  echo "Error: Must run from repository root containing backend/go.mod" >&2
  exit 1
fi

export PYTHONPATH="$REPO_ROOT/backend/scripts:${PYTHONPATH:-}"

IMAGE_REF="sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61"
DOCKER_BIN="docker"
DOCKER_CONTEXT="orbstack"

# Preflight: Verify image exists in orbstack context and validate immutable identity/platform
INSPECT_JSON=$($DOCKER_BIN --context "$DOCKER_CONTEXT" image inspect "$IMAGE_REF" 2>/dev/null) || {
  echo "Error: Required Docker image $IMAGE_REF not found in $DOCKER_CONTEXT context." >&2
  exit 1
}

python3 -c '
import sys
from study_load_runner_helpers import validate_image_inspect
validate_image_inspect(sys.argv[1], sys.argv[2])
' "$INSPECT_JSON" "$IMAGE_REF"

MODULE_CACHE=$(go env GOMODCACHE)
if [ ! -d "$MODULE_CACHE" ]; then
  echo "Error: Go module cache not found at $MODULE_CACHE" >&2
  exit 1
fi

EVIDENCE_OUT="$REPO_ROOT/docs/evidence/study-sustained-load-20261116.json"
mkdir -p "$REPO_ROOT/docs/evidence"

TMP_DIR=$(mktemp -d)
CONTAINER_NAME="signalgen-study-sustained-$(date +%s)-$$"

cleanup() {
  python3 -c '
import sys
from study_load_runner_helpers import docker_cleanup_container
docker_cleanup_container(sys.argv[1], sys.argv[2])
' "$CONTAINER_NAME" "$DOCKER_CONTEXT" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

# Safe tracked-source snapshot: copy tracked backend files with lstat regular-file checks
# and allowlist validation, excluding any .env or credentials.
python3 -c '
import sys
from pathlib import Path
from study_load_runner_helpers import safe_extract_tracked_source
res = safe_extract_tracked_source(Path(sys.argv[1]), Path(sys.argv[2]))
count = res["file_count"]
size = res["total_bytes"]
mhash = res["manifest_sha256"][:16]
print(f"Exported {count} tracked files ({size} bytes), manifest hash: {mhash}")
' "$REPO_ROOT" "$TMP_DIR"

SOURCE_COMMIT=$(git rev-parse HEAD)

echo "=== Running Sustained HTTP Signal-Study Load Workload ==="
echo "Image: $IMAGE_REF"
echo "Commit: $SOURCE_COMMIT"
echo "Output: $EVIDENCE_OUT"

TMP_CONTAINER_OUT="$TMP_DIR/container_out.txt"

# Run bounded isolated container with portable 180s host deadline
python3 -c '
import subprocess, sys
try:
    res = subprocess.run(sys.argv[1:], timeout=180)
    sys.exit(res.returncode)
except subprocess.TimeoutExpired:
    sys.stderr.write("Error: Host execution timed out after 180s\n")
    sys.exit(124)
' $DOCKER_BIN --context "$DOCKER_CONTEXT" run \
  --rm \
  --pull=never \
  --name "$CONTAINER_NAME" \
  --platform linux/arm64 \
  --network none \
  --read-only \
  --cpus 2 \
  --memory 2048m \
  --pids-limit 128 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --user 65534:65534 \
  --ulimit nofile=1024:1024 \
  --ulimit fsize=134217728:134217728 \
  --tmpfs /scratch:rw,exec,size=2147483648,mode=1777 \
  --mount "type=bind,src=$TMP_DIR/backend,dst=/target,readonly" \
  --mount "type=bind,src=$MODULE_CACHE,dst=/gomod,readonly" \
  -w /target "$IMAGE_REF" /bin/sh -c '
    set -eu
    mkdir -p /scratch/home /scratch/tmp /scratch/cache
    exec env -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home \
      TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod \
      GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
      SIGNALGEN_RUN_STUDY_SUSTAINED_LOAD=1 \
      SIGNALGEN_SOURCE_COMMIT="'"$SOURCE_COMMIT"'" \
      SIGNALGEN_TEST_SUSTAINED_OUTPUT=/scratch/study-sustained-load-20261116.json \
      SIGNALGEN_SUSTAINED_TIER_DURATION_SEC=5.0 \
      timeout 150 /bin/sh -c '\''
        echo "--- Running Go Vet ---" &&
        CGO_ENABLED=0 go vet ./internal/api/tests &&
        rm -rf /scratch/tmp/* &&
        echo "--- Running Correctness & Fault Tests (-race) ---" &&
        CGO_ENABLED=1 go test -race ./internal/api/tests -run "^(TestStudySustainedWorkloadCorrectnessAndOverloadRecovery|TestStudySustainedTargetedFaults)$" -v -count=1 &&
        rm -rf /scratch/tmp/* &&
        echo "--- Running Sustained Load Profile Measurement (>=5s per tier) ---" &&
        CGO_ENABLED=0 go test ./internal/api/tests -run "^TestStudySustainedLoadProfile$" -v -count=1 &&
        cat /scratch/study-sustained-load-20261116.json
      '\''
  ' 2>&1 | tee "$TMP_CONTAINER_OUT"

# Extract and validate JSON output using study_load_runner_helpers
python3 -c '
import json, sys
from study_load_runner_helpers import validate_evidence_json

content = sys.stdin.read()
marker = "\"kind\": \"loopback_http_sustained_workload\""
idx = content.find(marker)
if idx == -1:
    sys.stderr.write("Failed to find JSON evidence marker in container output\n")
    sys.exit(1)

start = content.rfind("{", 0, idx)
if start == -1:
    sys.stderr.write("Failed to find JSON start brace in output\n")
    sys.exit(1)

json_text = content[start:].strip()
data = validate_evidence_json(json_text)

with open(sys.argv[1], "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
' "$EVIDENCE_OUT" < "$TMP_CONTAINER_OUT"

echo "Successfully recorded verified sustained load evidence to $EVIDENCE_OUT"
echo "=== Sustained HTTP Signal-Study Load Workload Completed Successfully ==="
