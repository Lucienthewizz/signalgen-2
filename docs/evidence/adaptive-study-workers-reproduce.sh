#!/bin/sh
set -eu

# Reproduces the browser evidence without downloads or shared services.
# Required inputs:
#   DEPS_DIR  prepared dependency tree whose path is mounted read-only
#   WASM_DIR  current-source signalgen_core.wasm, wasm_exec.js, and manifest
# Optional:
#   EVIDENCE_DIR output directory (default: /tmp/signalgen-adaptive-evidence)
DEPS_DIR=${DEPS_DIR:?set DEPS_DIR to the approved prepared node_modules tree}
WASM_DIR=${WASM_DIR:?set WASM_DIR to current-source WASM artifacts}
EVIDENCE_DIR=${EVIDENCE_DIR:-/tmp/signalgen-adaptive-evidence}
IMAGE=sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197
ROOT=$(git rev-parse --show-toplevel)
mkdir -p "$EVIDENCE_DIR"

run_case() {
  mode=$1
  candles=$2
  operands=$3
  label=$4
  docker run --rm --network none --read-only \
    --tmpfs /tmp:rw,exec,size=3g --pids-limit 512 --cpus 2 --memory 3g \
    --ulimit fsize=209715200 --user 1000:1000 \
    -v "$ROOT:/source:ro" -v "$WASM_DIR:/wasm:ro" \
    -v "$DEPS_DIR:/toolchain/node_modules:ro" \
    -v "$EVIDENCE_DIR:/evidence:rw" "$IMAGE" sh -ec '
      mkdir -p /tmp/repo /tmp/repo/frontend/web/public/wasm
      cp -a /source/frontend /tmp/repo/
      cp /wasm/* /tmp/repo/frontend/web/public/wasm/
      ln -s /toolchain/node_modules /tmp/repo/frontend/web/node_modules
      cat >/tmp/vite.config.ts <<EOF
import config from "/tmp/repo/frontend/web/vite.config.ts";
export default {...config, root:"/tmp/repo/frontend/web", cacheDir:"/tmp/vite-cache"};
EOF
      cd /tmp/repo/frontend/web
      /toolchain/node_modules/.bin/vite --config /tmp/vite.config.ts \
        --host 127.0.0.1 --port 5174 >/tmp/vite.log 2>&1 &
      pid=$!
      trap "kill $pid 2>/dev/null || true" EXIT
      node -e "let n=0;(async()=>{for(;n<100;n++){try{if((await fetch(\"http://127.0.0.1:5174/ready\")).ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,100))}process.exit(1)})()"
      SIGNALGEN_TEST_BASE_URL="http://127.0.0.1:5174/?workers='"$mode"'&candles='"$candles"'&operands='"$operands"'" \
        NODE_PATH=/toolchain/node_modules node scripts/test-browser.mjs --study
      cp output/playwright/signal-study-browser.json /evidence/'"$label"'.json
    '
}

# Alternating order is intentional: each workload has two adaptive/baseline
# pairs, with a fresh bounded container for every case.
run_case 4 250 3 small-adaptive-1
run_case 1 250 3 small-baseline-1
run_case 4 250 3 small-adaptive-2
run_case 1 250 3 small-baseline-2
run_case 4 1250 5 heavy-adaptive-1
run_case 1 1250 5 heavy-baseline-1
run_case 4 1250 5 heavy-adaptive-2
run_case 1 1250 5 heavy-baseline-2

node "$ROOT/frontend/web/tests/browser/compare-signal-study-evidence.mjs" \
  "$EVIDENCE_DIR/small-adaptive-1.json" "$EVIDENCE_DIR/small-baseline-1.json"
node "$ROOT/frontend/web/tests/browser/compare-signal-study-evidence.mjs" \
  "$EVIDENCE_DIR/small-adaptive-2.json" "$EVIDENCE_DIR/small-baseline-2.json"
node "$ROOT/frontend/web/tests/browser/compare-signal-study-evidence.mjs" \
  "$EVIDENCE_DIR/heavy-adaptive-1.json" "$EVIDENCE_DIR/heavy-baseline-1.json"
node "$ROOT/frontend/web/tests/browser/compare-signal-study-evidence.mjs" \
  "$EVIDENCE_DIR/heavy-adaptive-2.json" "$EVIDENCE_DIR/heavy-baseline-2.json"
