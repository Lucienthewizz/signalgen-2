#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
artifact_dir="$(mktemp -d /tmp/signalgen-backtest-wasm.XXXXXX)"
trap 'rm -rf "$artifact_dir"' EXIT
GOOS=js GOARCH=wasm go build -o "$artifact_dir/signalgen_core.wasm" ./cmd/wasm
bash scripts/verify_wasm_boundary.sh "$artifact_dir/signalgen_core.wasm"
node scripts/check_backtest_wasm.mjs "$artifact_dir/signalgen_core.wasm" "$(go env GOROOT)/lib/wasm/wasm_exec.js"
