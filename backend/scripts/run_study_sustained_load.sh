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

IMAGE_REF="sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61"
DOCKER_BIN="docker"
DOCKER_CONTEXT="orbstack"

# Preflight: Verify image exists in orbstack context and validate immutable identity/platform
INSPECT_JSON=$($DOCKER_BIN --context "$DOCKER_CONTEXT" image inspect "$IMAGE_REF" 2>/dev/null) || {
  echo "Error: Required Docker image $IMAGE_REF not found in $DOCKER_CONTEXT context." >&2
  exit 1
}

python3 -c '
import json, sys
data = json.loads(sys.argv[1])[0]
img_id = data.get("Id")
if img_id != sys.argv[2]:
    sys.stderr.write("Error: Image ID mismatch: " + str(img_id) + " != " + sys.argv[2] + "\n")
    sys.exit(1)
if data.get("Architecture") != "arm64":
    sys.stderr.write("Error: Unexpected architecture: " + str(data.get("Architecture")) + "\n")
    sys.exit(1)
if data.get("Os") != "linux":
    sys.stderr.write("Error: Unexpected OS: " + str(data.get("Os")) + "\n")
    sys.exit(1)
if data.get("Config", {}).get("OnBuild"):
    sys.stderr.write("Error: Pinned image contains unexpected OnBuild triggers\n")
    sys.exit(1)
' "$INSPECT_JSON" "$IMAGE_REF"

MODULE_CACHE=$(go env GOMODCACHE)
if [ ! -d "$MODULE_CACHE" ]; then
  echo "Error: Go module cache not found at $MODULE_CACHE" >&2
  exit 1
fi

EVIDENCE_OUT="$REPO_ROOT/docs/evidence/study-sustained-load-20261116.json"
mkdir -p "$REPO_ROOT/docs/evidence"

# Disposable tracked-source snapshot: export tracked backend source via git archive
TMP_DIR=$(mktemp -d)
CONTAINER_NAME="signalgen-study-sustained-$(date +%s)-$$"

cleanup() {
  $DOCKER_BIN --context "$DOCKER_CONTEXT" rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

TREE_REF=$(git stash create 2>/dev/null || echo "")
if [ -z "$TREE_REF" ]; then
  TREE_REF="HEAD"
fi
git archive "$TREE_REF" backend | tar -x -C "$TMP_DIR"

# Strip all .env files from the snapshot so none enter container
find "$TMP_DIR/backend" -name ".env*" -delete

# Verify exported snapshot has no credentials, no .env, and matches allowlist
python3 -c '
import os, sys
from pathlib import Path

src = Path(sys.argv[1]) / "backend"
allowed_exts = {".go", ".mod", ".sum", ".sh", ".py", ".sql", ".md", ".json", ".yml", ".yaml", ".txt", ".mjs", ".cjs"}
disallowed_names = {".env", ".env.local", ".env.production", "localstack.db", "runtime.db"}

total_bytes = 0
for root, _, files in os.walk(src):
    for f in files:
        p = Path(root) / f
        if f.startswith(".env") or f in disallowed_names or p.suffix in {".pem", ".key", ".sqlite", ".db"}:
            sys.stderr.write(f"Error: Disallowed file in source snapshot: {p}\n")
            sys.exit(1)
        if p.suffix not in allowed_exts and not f.endswith("Dockerfile") and not "Dockerfile" in f and f != ".gitignore":
            sys.stderr.write(f"Error: Extension not allowed in snapshot: {p}\n")
            sys.exit(1)
        sz = p.stat().st_size
        if sz > 32 * 1024 * 1024:
            sys.stderr.write(f"Error: Oversized file in snapshot: {p} ({sz} bytes)\n")
            sys.exit(1)
        total_bytes += sz

if total_bytes > 64 * 1024 * 1024:
    sys.stderr.write(f"Error: Total snapshot size exceeds 64MB: {total_bytes} bytes\n")
    sys.exit(1)
' "$TMP_DIR"

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
  ' > "$TMP_CONTAINER_OUT"

# Extract and validate JSON output
python3 -c '
import sys, json

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
data = json.loads(json_text)

schema_ver = data.get("schema_version")
if schema_ver != 3:
    sys.stderr.write("Unexpected schema version: " + str(schema_ver) + "\n")
    sys.exit(1)

runs = data.get("runs", [])
if len(runs) != 4:
    sys.stderr.write("Expected 4 concurrency runs, got " + str(len(runs)) + "\n")
    sys.exit(1)

for r in runs:
    conc = r.get("concurrency")
    failed = r.get("failed", 0)
    dur = r.get("measured_duration_ms", 0)
    if failed > 0:
        sys.stderr.write("Run concurrency " + str(conc) + " had unexpected failures: " + str(failed) + "\n")
        sys.exit(1)
    if dur < 4500:
        sys.stderr.write("Run concurrency " + str(conc) + " measured duration < 4.5s: " + str(dur) + "ms\n")
        sys.exit(1)

with open(sys.argv[1], "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"Successfully recorded verified sustained load evidence to {sys.argv[1]}")
' "$EVIDENCE_OUT" < "$TMP_CONTAINER_OUT"

echo "=== Sustained HTTP Signal-Study Load Workload Completed Successfully ==="
