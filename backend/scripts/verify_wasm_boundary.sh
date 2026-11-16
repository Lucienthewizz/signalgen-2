#!/usr/bin/env bash
set -euo pipefail

artifact="${1:-}"
if [[ -z "$artifact" || ! -f "$artifact" ]]; then
  echo "usage: $0 path/to/signalgen_core.wasm" >&2
  exit 2
fi

search_bin() {
  if command -v rg >/dev/null 2>&1; then
    rg -a -q "$1" "$2"
  else
    grep -a -q "$1" "$2"
  fi
}

if ! search_bin "signalgenComputeFeatures" "$artifact"; then
  echo "missing signalgenComputeFeatures export marker" >&2
  exit 1
fi

for required in signalgenRunBacktest signalgenComputeBacktestFeatures signalgenBacktestCapabilities signalgenRunSignalStudy; do
  if ! search_bin "$required" "$artifact"; then
    echo "missing backtest export marker: $required" >&2
    exit 1
  fi
done

for forbidden in signalgenRunSignals "Default Scalping" RULE_MATCHED; do
  if search_bin "$forbidden" "$artifact"; then
    echo "forbidden decision marker found in WASM: $forbidden" >&2
    exit 1
  fi
done

echo "WASM boundary markers verified: feature export present, known decision markers absent"
