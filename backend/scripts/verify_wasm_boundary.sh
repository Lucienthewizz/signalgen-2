#!/usr/bin/env bash
set -euo pipefail

artifact="${1:-}"
if [[ -z "$artifact" || ! -f "$artifact" ]]; then
  echo "usage: $0 path/to/signalgen_core.wasm" >&2
  exit 2
fi

if ! rg -a -q "signalgenComputeFeatures" "$artifact"; then
  echo "missing signalgenComputeFeatures export marker" >&2
  exit 1
fi

for forbidden in signalgenRunSignals "Default Scalping" RULE_MATCHED; do
  if rg -a -q "$forbidden" "$artifact"; then
    echo "forbidden decision marker found in WASM: $forbidden" >&2
    exit 1
  fi
done

echo "WASM boundary markers verified: feature export present, known decision markers absent"
