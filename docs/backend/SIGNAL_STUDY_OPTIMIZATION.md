# Signal-study outcomes optimization

`RunSignalStudy` now retains the last matched candle position for each symbol. The dense ten-symbol, 1000-candle native median fell from 90.04 ms to 25.03 ms in the paired non-race run; the real-WASM median fell from 440.50 ms to 126.20 ms. These are synthetic engine measurements. The paired 500-symbol orchestration run is reported separately below.

## Profile and change

The baseline is integration commit `5bb111d626625bede93e4f7d590c19227a247699`. Its dense-case CPU profile attributed 82.21% of samples cumulatively to `time.Parse`. The per-entry lookup scanned each symbol's candle prefix again, parsing the same timestamps repeatedly. The existing sort also parses timestamps; its comparator is unchanged.

Validated candle series are strictly chronological, and entries are already sorted by instant before evaluation. For each symbol, a later entry cannot match a candle preceding the previous match. The lookup therefore starts at that symbol's last matched position, including the matched candle itself so equal-instant duplicates retain the original first-match and rejection behavior. It still uses `time.Parse(time.RFC3339Nano, ...)` and `Time.Equal`; no integer timestamp conversion or UnixNano range shortcut is introduced. Extra cursor state is bounded by the ten-symbol engine batch limit.

Only the lookup cursor changes. Validation order, sorting, arithmetic, rounding, outcome generation, incomplete horizons, BUY/SELL direction, SL-first barriers, target-hit metrics, groups and every event remain unchanged. No concurrency, signal cap, policy/schema change or reduced output is added. In the after profile, JSON encoding dominates; `time.parseRFC3339` accounts for 13.84% cumulatively. Profiles are retained as [before](../evidence/signal-study-optimization-profile-before-20261112.txt) and [after](../evidence/signal-study-optimization-profile-after-20261112.txt).

## Full-result equivalence

The baseline source generated 29 deterministic cases and the [frozen input/result/error hashes](../../backend/core/testdata/signal_study_performance_golden.json). The current core test regenerates those inputs, serializes the entire result with Go `json.Marshal`, and compares its SHA-256, including every event/outcome, horizon, group, warning and additive target field. Error cases compare exact messages. Real-WASM checks hash the complete raw Go result JSON from the response envelope, avoiding JavaScript float re-serialization and page/summary truncation.

Cases include ten-symbol sparse/dense workloads, 300/1000/2500 candles, horizons through 100, twelve fixed random seeds, mixed BUY/SELL, targets and no targets, empty entries, incomplete outcomes, nanosecond timestamps, different RFC3339 offsets for equal instants, and years 0001 and 9998. Nine rejection cases cover malformed timestamps, duplicate instants, unknown symbols, invalid sides, warmup entries, invalid series/schema, out-of-range signals and a one-nanosecond mismatch. Existing core tests additionally check SL-first, target-hit metrics, flat returns and the frozen Claudio fixture. All 29 native and real-WASM baseline/result or rejection comparisons passed.

## Native engine measurements

Before and after ran sequentially in one isolated Linux arm64 container using Go 1.27.2, GOMAXPROCS=1, three warmups and fifteen measured samples per case. The test timer covers `RunSignalStudy`, including its existing final JSON arithmetic validation; it excludes request generation, decoding and outer response encoding. CPU profiles use a separate three-second dense-case benchmark. The host was an Apple M5 with ten logical CPUs and 16 GiB RAM; other host development activity was not fully controlled. All p95 values use nearest rank; with 15, 9 or 5 samples, they equal the observed sample maximum.

| Case | Before median ms | After median ms | Before p95 ms | After p95 ms |
| --- | ---: | ---: | ---: | ---: |
| sparse_10x300_h5 | 1.33 | 0.92 | 2.26 | 1.58 |
| dense_10x300_h5 | 31.43 | 24.01 | 39.03 | 25.35 |
| dense_10x1000_h5 | 90.04 | 25.03 | 95.42 | 26.96 |
| sparse_10x2500_h100 | 9.38 | 7.38 | 14.35 | 11.90 |

[Raw native evidence](../evidence/signal-study-optimization-native-20261112.json) includes all samples and process allocation deltas. Median allocation deltas rose by 440–456 bytes per call in these cases, consistent with the small cursor map; they remain approximately 0.7–17.4 MB per call depending on output size. These deltas are process-wide allocations around the engine call, not peak live heap or RSS. The container limit was 2 GiB; this is not a measured memory requirement.

An initial after timing file was overwritten by subsequent race tests. Those instrumented timings were discarded. The authoritative native evidence is a new non-race before/after pair; correctness and race results are recorded separately.

## Real browser Go/WASM measurements

The [isolated browser script](../../frontend/web/tests/browser/signal-study-optimization.cli.js) runs the actual WASM function in a module worker, with frozen synthetic requests. It measures Go request decoding, the engine, Go response encoding and return to JavaScript. Fixture generation, outer worker messaging, hashing, network and UI work are outside its timer. The first call is recorded separately; three calls per performance case precede nine measured samples in one reused worker. Later cases share that worker, so their first-call figures are not fresh-runtime startup measurements. Browser/worker peak heap and RSS were not measured.

Both phases used fresh isolated headless Chrome 157 contexts on Vite port 5183, with matching SHA-verified WASM/runtime manifests. Own benchmarks ran sequentially, and no build ran alongside browser tests. Playwright routing disables HTTP cache. This tests synthetic workloads on one desktop, not physical-device or production performance.

| Case | Before median ms | After median ms | Before p95 ms | After p95 ms |
| --- | ---: | ---: | ---: | ---: |
| sparse_10x300_h5 | 15.20 | 13.30 | 15.70 | 14.50 |
| dense_10x300_h5 | 191.80 | 144.40 | 209.10 | 163.80 |
| dense_10x1000_h5 | 440.50 | 126.20 | 450.80 | 186.90 |
| sparse_10x2500_h100 | 111.90 | 100.20 | 113.90 | 103.10 |

[Raw WASM evidence](../evidence/signal-study-optimization-wasm-20261112.json) contains nine timings per performance case and all 29 complete-result/error comparisons. The dense 1000-candle reduction is about 71%; sparse cases improve less because lookup work is a smaller part of total work.

## Paired 500-symbol orchestration observation

The unchanged `screening-performance.cli.js` backtest workload was rerun before and after on this same integration base and setup: 500 synthetic symbols, 300 candles each, a five-step horizon, one first run and five subsequent samples per phase. It exercises real worker/WASM, integrity checking and IndexedDB, with synthetic API/provider/private-decision responses.

The subsequent median outcomes stage was 1526.0 ms before and 1213.2 ms after. Total median was 4746.6 ms before and 3828.3 ms after, with p95 totals 4952.6 and 3858.8 ms. Other stages also varied, so the entire total-time difference is not attributed to the cursor change. With five samples, p95 is the observed maximum. These local totals exclude React rendering and real provider, authorization, database and private-rule latency.

[Full raw orchestration measurements](../evidence/signal-study-optimization-e2e-20261112.json) retain every stage. That existing runner's repeat hash covers aggregate summaries and the first 50 stored events, with a total event count; full output equivalence is established by the separate 29-case engine checks above. It does not establish 1000-user capacity or Yahoo/IDX coverage.

## Reproduce

Use the existing `golang:1.27.2-bookworm` image and module cache. For a baseline, create a disposable `git archive` of the exact base and copy only the new benchmark test into its `backend/core` folder. Do not replace baseline product code with the optimized source. Mount the base as `/before` and current backend as `/after`, both read-only. The isolated command below writes only to a bounded scratch tmpfs and disables dependency/network fetches:

```sh
perf_base=$(mktemp -d /tmp/signalgen-study-before.XXXXXX)
perf_script=$(mktemp /tmp/signalgen-study-pair.XXXXXX)
git archive 5bb111d626625bede93e4f7d590c19227a247699 backend | tar -x -C "$perf_base"
cp backend/core/signal_study_performance_test.go "$perf_base/backend/core/"
cat > "$perf_script" <<'SH'
set -e
cd /before
SIGNALGEN_STUDY_FREEZE=/scratch/golden.json SIGNALGEN_STUDY_FIXTURES=/scratch/fixtures.json SIGNALGEN_STUDY_PERF_OUTPUT=/scratch/before.json go test ./core -run '^TestSignalStudyPerformance' -count=1
cd /after
SIGNALGEN_STUDY_PERF_OUTPUT=/scratch/after.json go test ./core -run '^TestSignalStudyPerformance' -count=1
echo BEFORE; cat /scratch/before.json
echo AFTER; cat /scratch/after.json
echo FIXTURES; cat /scratch/fixtures.json
SH
docker run --rm --pull=never --network none --read-only --cpus 2 --memory 2g --pids-limit 128 \
  --ulimit nofile=1024:1024 --ulimit fsize=67108864:67108864 \
  --tmpfs /scratch:rw,exec,size=1073741824 \
  --mount "type=bind,src=$perf_base/backend,dst=/before,readonly" \
  --mount "type=bind,src=$PWD/backend,dst=/after,readonly" \
  --mount "type=bind,src=$perf_script,dst=/run-pair.sh,readonly" \
  --mount "type=bind,src=$(go env GOMODCACHE),dst=/gomod,readonly" \
  golang:1.27.2-bookworm /bin/sh -ec '
    mkdir -p /scratch/home /scratch/tmp /scratch/cache
    env -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod GOPROXY=off GOSUMDB=off GOMAXPROCS=1 timeout 240 /bin/sh /run-pair.sh
  ' > /tmp/signal-study-pair.log
```

For profiles, in the same isolation use `go test ./core -run '^$' -bench '^BenchmarkSignalStudyPerformance/dense_10x1000_h5$' -benchtime=3s -cpuprofile=/scratch/cpu.pprof -o /scratch/core.test`, then `go tool pprof -top -nodecount=18 /scratch/core.test /scratch/cpu.pprof`. For correctness/race/vet, unset the performance-output/freeze variables and run `go test ./core -count=1`, `go test -race ./core -count=1` and `go vet ./core` in that isolation. The combined correctness/race/artifact run used a 2 GiB scratch tmpfs and a 360-second wall limit; the native paired measurement used 1 GiB scratch and 240 seconds. All runs limited CPU, memory, PIDs, file size and open files as above.

For browser runs, export the fixture JSON after the `FIXTURES` marker to the temporary local `frontend/web/public/study-perf-fixtures.json`. Build WASM from each phase inside the same isolation using `GOOS=js GOARCH=wasm go build -trimpath -o /scratch/signalgen_core.wasm ./cmd/wasm`, copy the matching `/usr/local/go/lib/wasm/wasm_exec.js`, and run `go run ./cmd/wasmmanifest --wasm /scratch/signalgen_core.wasm --runtime /scratch/wasm_exec.js --output /scratch/manifest.json`. Parent-side artifact transfer must verify manifest sizes and SHA-256 before replacing only that worktree's ignored `public/wasm` assets. The recorded runs transferred bounded base64 artifacts via stdout; no build artifact is committed.

Start Vite only after the build finishes, on an unused worktree-owned port. With the existing Playwright CLI, open the local WASM manifest in a fresh isolated context, take a snapshot, then run:

```sh
playwright-cli -s=study-perf run-code --filename=frontend/web/tests/browser/signal-study-optimization.cli.js
# Optional case selection: open manifest URL with ?case=dense_10x1000_h5 first.
# Paired orchestration: use ?symbols=500&purpose=backtest and the existing runner.
playwright-cli -s=study-perf run-code --filename=frontend/web/tests/browser/screening-performance.cli.js
playwright-cli -s=study-perf close
```

Reject CLI `### Error` output and parse the `### Result` JSON, even when the CLI process returns zero. Use the existing `scripts/benchmark-indicators.mjs` or performance report's CLI config pattern for an installed browser executable; do not install tools or use a personal profile. Remove the temporary public fixture file afterward. Rebuild matching phase assets before switching phases, and avoid running other benchmarks concurrently.

## Verification and limits

Core correctness, frozen equivalence, race tests and vet passed in isolated no-network Docker. Frontend checks passed: 262 unit tests, typecheck, full format check, production build and performance budgets. The existing real-WASM study, evaluation-options and target-hit regressions cover outcome displays, full CSV/target summaries, legacy/no-target behavior, partial failure, Stop and storage handling. Exact commands and final results are in the [validation evidence](../evidence/signal-study-optimization-validation-20261112.json).

The graph service returned `Transport closed` for indexing, search and coverage requests; direct current-source reads and compiler/test evidence were used, without a graph completeness claim. Dataset/API capacity, collection, Docker/deployment configuration, frontend UI/styles/dependencies and metric contracts are unchanged. No cloud deployment, live provider load, peak-memory measurement, sustained-load test or production-capacity claim is included.
