#!/bin/sh
# Bounded offline profile of a whole-market purpose=screen scan
# (TestScreenRealCatalogTiming) against a pinned, read-only idx_store copy.
# Native Go HTTP harness: it does not measure browser Worker/WASM/IndexedDB.
#
# Usage, from the repository root:
#   SCREEN_STORE=<store root whose current.json names one generation> \
#   SCREEN_CATALOG=<962-item catalog.json> SCREEN_OUT=<writable dir> \
#   [SCREEN_REPORT_SHA256=<expected generation report.json sha256>] \
#   [GOMODCACHE_HOST=$HOME/go/pkg/mod] backend/scripts/profile_screen_catalog.sh
# Never point SCREEN_STORE at a live store the scheduler is updating.
set -eu
: "${SCREEN_STORE:?}" "${SCREEN_CATALOG:?}" "${SCREEN_OUT:?}"
GO_IMAGE=golang@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61
MODS=${GOMODCACHE_HOST:-$HOME/go/pkg/mod}
GENERATION=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["generation"])' "$SCREEN_STORE/current.json")
REPORT_SHA=$(shasum -a 256 "$SCREEN_STORE/$GENERATION/report.json" | cut -d' ' -f1)
if [ -n "${SCREEN_REPORT_SHA256:-}" ] && [ "$REPORT_SHA" != "$SCREEN_REPORT_SHA256" ]; then
  echo "report.json sha256 $REPORT_SHA does not match pin" >&2; exit 1
fi
mkdir -p "$SCREEN_OUT/bin" "$SCREEN_OUT/gocache"
LIMITS="--rm --network none --read-only --user 65532:65532 --cpus 2 --memory 3g --pids-limit 256 --ulimit nofile=4096 --ulimit fsize=268435456 -e HOME=/tmp"

docker run $LIMITS --tmpfs /tmp:rw,size=512m -e GOFLAGS=-mod=mod -e GOPROXY=off -e GOTOOLCHAIN=local \
  -e GOCACHE=/cache -e GOMODCACHE=/gomod -e CGO_ENABLED=0 \
  -v "$PWD/backend":/src:ro -v "$MODS":/gomod:ro -v "$SCREEN_OUT/gocache":/cache:rw -v "$SCREEN_OUT/bin":/out:rw -w /src \
  "$GO_IMAGE" timeout 600 go test -c -o /out/apitests.test ./internal/api/tests/

run() { # name from to runs rtt
  dir="$SCREEN_OUT/$1"; mkdir -p "$dir"; chmod 777 "$dir"
  docker run $LIMITS --tmpfs /tmp:rw,size=64m \
    -e SIGNALGEN_SCREEN_STORE=/store -e SIGNALGEN_SCREEN_CATALOG=/catalog.json -e SIGNALGEN_SCREEN_EXPECT_TOTAL=962 \
    -e SIGNALGEN_SCREEN_FROM="$2" -e SIGNALGEN_SCREEN_TO="$3" -e SIGNALGEN_SCREEN_RUNS="$4" -e SIGNALGEN_SCREEN_RTT="$5" \
    -e SIGNALGEN_SCREEN_OUT=/out/timing.json -e SIGNALGEN_SCREEN_ORACLE_OUT=/out/oracle.json \
    -v "$SCREEN_STORE":/store:ro -v "$SCREEN_CATALOG":/catalog.json:ro -v "$SCREEN_OUT/bin/apitests.test":/apitests.test:ro -v "$dir":/out:rw \
    "$GO_IMAGE" timeout 1500 /apitests.test -test.run '^TestScreenRealCatalogTiming$' -test.v -test.timeout 25m -test.cpuprofile /out/cpu.pprof \
    | tee "$dir/log.txt" | grep -E 'run=|^(PASS|FAIL|---)'
}
echo "generation=$GENERATION report_sha256=$REPORT_SHA"
run short 2026-11-13 2026-11-13 3 0s     # UI default: one signal day
run year 2025-11-14 2026-11-13 3 0s      # largest allowed window (one year)
run short-rtt20 2026-11-13 2026-11-13 1 20ms
run short-rtt80 2026-11-13 2026-11-13 1 80ms
run year-rtt80 2025-11-14 2026-11-13 1 80ms
