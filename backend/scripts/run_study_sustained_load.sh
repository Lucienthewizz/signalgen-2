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

IMAGE_ID="golang:1.27.2-bookworm"
IMAGE_SHA="sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61"

# Verify pinned Go Docker image without pulling
docker image inspect "$IMAGE_ID" >/dev/null 2>&1 || {
  echo "Error: Required Docker image $IMAGE_ID not found locally." >&2
  exit 1
}

MODULE_CACHE=$(go env GOMODCACHE)
if [ ! -d "$MODULE_CACHE" ]; then
  echo "Error: Go module cache not found at $MODULE_CACHE" >&2
  exit 1
fi

EVIDENCE_OUT="$REPO_ROOT/docs/evidence/study-sustained-load-20261118.json"
mkdir -p "$REPO_ROOT/docs/evidence"

echo "=== Running Sustained HTTP Signal-Study Load Workload ==="
echo "Image: $IMAGE_ID ($IMAGE_SHA)"
echo "Output: $EVIDENCE_OUT"

TMP_CONTAINER_OUT=$(mktemp)
trap 'rm -f "$TMP_CONTAINER_OUT"' EXIT

docker run --rm --network none --read-only --cpus 2 --memory 2048m --pids-limit 128 \
  --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 \
  --ulimit nofile=1024:1024 --ulimit fsize=134217728:134217728 \
  --tmpfs /scratch:rw,exec,size=2147483648,mode=1777 \
  --mount "type=bind,src=$REPO_ROOT/backend,dst=/target,readonly" \
  --mount "type=bind,src=$MODULE_CACHE,dst=/gomod,readonly" \
  -w /target "$IMAGE_ID" /bin/sh -c '
    set -eu
    mkdir -p /scratch/home /scratch/tmp /scratch/cache
    exec env -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home \
      TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod \
      GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
      SIGNALGEN_TEST_SUSTAINED_OUTPUT=/scratch/study-sustained-load-20261118.json \
      timeout 180 /bin/sh -c '\''
        echo "--- Running Go Vet ---" &&
        CGO_ENABLED=0 go vet ./internal/api/tests &&
        rm -rf /scratch/tmp/* &&
        echo "--- Running Correctness & Overload Recovery Tests (-race) ---" &&
        CGO_ENABLED=1 go test -race ./internal/api/tests -run TestStudySustainedWorkloadCorrectnessAndOverloadRecovery -v -count=1 &&
        rm -rf /scratch/tmp/* &&
        echo "--- Running Sustained Load Profile Measurement ---" &&
        CGO_ENABLED=0 go test ./internal/api/tests -run TestStudySustainedLoadProfile -v -count=1 &&
        cat /scratch/study-sustained-load-20261118.json
      '\''
  ' > "$TMP_CONTAINER_OUT"

# Extract the JSON payload from container output
# The JSON object starts with "{\n  \"arch\":" and ends with "}\n"
python3 -c '
import sys, json

content = sys.stdin.read()
start = content.find("{\n  \"arch\":")
if start == -1:
    start = content.find("{\n  \"cpus\":")
if start == -1:
    # Look for last JSON object
    for i in range(len(content)):
        if content[i] == "{" and "\"kind\": \"loopback_http_sustained_workload\"" in content[i:]:
            start = i
            break

if start == -1:
    sys.stderr.write("Failed to find JSON evidence in output\n")
    sys.exit(1)

json_text = content[start:].strip()
data = json.loads(json_text)
with open(sys.argv[1], "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"Successfully recorded sustained load evidence to {sys.argv[1]}")
' "$EVIDENCE_OUT" < "$TMP_CONTAINER_OUT"

echo "=== Sustained HTTP Signal-Study Load Workload Completed Successfully ==="
