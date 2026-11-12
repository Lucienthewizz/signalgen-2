# Screening and backtest performance baseline

Measured on 12 November 2026 at `3ee6f3aa684e805c78f6f0d9af484c58ee64ae2c` in the screening-performance worktree. This change adds a reproducible benchmark and evidence; it does not change product orchestration, private scoring, admission limits, or market collection.

## Browser workload and results

The benchmark uses real `runSignalStudy`, one real worker per run, Go/WASM features and backtest outcomes, SHA-256 content checks, and native IndexedDB. Account, entitlement, catalog, prepare, grants, and private decisions are synthetic Playwright route fixtures. The decision fixture returns predetermined BUY entries throughout September; it does not implement a private rule in the browser. This is synthetic US/UTC daily data, including weekends, rather than an IDX trading calendar or provider coverage test.

Each case has one first run and five subsequent runs in a fresh isolated Chrome context, with a fresh worker for every run. The report calls subsequent samples `warm`, meaning the same browser context: Playwright routing disables HTTP cache, and no provider/cache warmth is implied. The manifest is navigated before measurement. The five-sample p95 is the maximum observed sample, not a stable capacity estimate. The machine had other development activity, so small differences should not be treated as speedups.

Environment: Apple M5, 10 logical CPUs, 16 GiB RAM, macOS 26.6.2 arm64, Node 24.15.0, Vite development server on port 5183. Exact Chrome user agent and raw samples are in [browser evidence](../evidence/screening-performance-browser-20261112.json). Browser totals exclude module imports, clearing previous IndexedDB results, post-run validation, and UI rendering; they include worker startup and the full sequential catalog run.

| Purpose | Symbols | Candles/symbol | First run ms | Subsequent median ms | Subsequent p95 ms | Samples after first |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Screen | 10 | 273 | 145.9 | 127.2 | 140.4 | 5 |
| Screen | 100 | 273 | 714.3 | 696.9 | 1141.2 | 5 |
| Screen | 500 | 273 | 3074.4 | 4041.0 | 4811.7 | 5 |
| Backtest | 10 | 300 | 195.8 | 185.0 | 207.1 | 5 |
| Backtest | 100 | 300 | 1093.6 | 1042.6 | 1136.0 | 5 |
| Backtest | 500 | 300 | 6773.3 | 4618.5 | 4760.9 | 5 |

The 500-symbol screen median stages were 714.5 ms for features, 1031.1 ms for the synthetic scoring round trips, 608.0 ms for transfer/checksum/parse, and 226.3 ms for storage. For backtest, features took 722.8 ms, synthetic scoring 895.7 ms, and real WASM outcomes 1535.4 ms. Individual stage medians do not add up to the median total. Prepare includes generating fixtures and hashing their data in the automation process; scoring includes transport, candidate JSON serialization/parsing, and the fixture response, rather than server private-rule CPU time.

At 500 symbols, the screen decoded 14,101,796 candle bytes and serialized 20,505,623 candidate bytes; backtest decoded 15,485,169 and serialized 22,685,745 respectively. These are decoded UTF-8 JSON counts, not compressed network bytes. Browser/worker peak memory and CPU were not measured. The fixture retains at most ten snapshot strings, and every run verifies sequential frozen batch traversal, one scoring call per symbol, release of all handles, zero failures, and 30 stored events per symbol. Screen candles end on September 30; backtest alone includes October outcome candles. Repeated-output hashes cover aggregate summaries and the first 50 stored events, with a separate count of all events; they do not prove equivalence of every stored outcome.

## Reproduce the browser measurement

From the repository root, restore the existing lockfile dependencies and build matching WASM assets. Generated files remain ignored:

```sh
(cd frontend/web && npm ci --ignore-scripts --no-audit --no-fund)
mkdir -p frontend/web/public/wasm
(cd backend && GOOS=js GOARCH=wasm go build -o ../frontend/web/public/wasm/signalgen_core.wasm ./cmd/wasm)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" frontend/web/public/wasm/wasm_exec.js
(cd backend && go run ./cmd/wasmmanifest --wasm ../frontend/web/public/wasm/signalgen_core.wasm --runtime ../frontend/web/public/wasm/wasm_exec.js --output ../frontend/web/public/wasm/signalgen_core.manifest.json)
(cd frontend/web && npm run dev -- --port 5183)
```

Use the already installed Playwright CLI. A config for this Mac is shown below; choose an existing browser executable for another machine. Do not install optional browser integrations or use an existing personal browser profile.

```sh
cat > /tmp/signalgen-performance-browser.json <<'JSON'
{"browser":{"browserName":"chromium","isolated":true,"launchOptions":{"headless":true,"executablePath":"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"},"contextOptions":{"viewport":{"width":1440,"height":1000}}}}
JSON
mkdir -p frontend/web/output/playwright
# Set this to the installed playwright-cli, or its existing skill wrapper.
perf_cli="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
for purpose in screen backtest; do
  for symbols in 10 100 500; do
    perf_session="screening-performance-$purpose-$symbols"
    "$perf_cli" -s="$perf_session" open "http://127.0.0.1:5183/wasm/signalgen_core.manifest.json?symbols=$symbols&purpose=$purpose" --config /tmp/signalgen-performance-browser.json
    "$perf_cli" -s="$perf_session" snapshot
    "$perf_cli" -s="$perf_session" run-code --filename=frontend/web/tests/browser/screening-performance.cli.js > "frontend/web/output/playwright/performance-$purpose-$symbols.txt"
    "$perf_cli" -s="$perf_session" close
  done
done
```

Each CLI file contains a `### Result` JSON object followed by execution details. Extract it with this check, which fails on CLI errors, missing results, or malformed JSON:

```sh
python3 - <<'PY'
import json, pathlib
for path in pathlib.Path("frontend/web/output/playwright").glob("performance-*.txt"):
    text = path.read_text()
    if "### Error" in text:
        raise RuntimeError(text)
    result = json.loads(text.split("### Result\n", 1)[1].split("\n### ", 1)[0])
    path.with_suffix(".json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
PY
```

The checked-in compact JSON combines those six result objects and adds host metadata. Use separate fresh sessions for a repeat, keep ports/worktrees isolated, and avoid running other benchmarks simultaneously when comparing a proposed optimization.

## Backend compute and admission

[Native compute evidence](../evidence/screening-performance-native-20261112.json) comes from the existing script:

```sh
(cd backend && go run ./scripts/benchmark_model_a.go > /tmp/signalgen-screening-compute.json)
```

It compares ten-symbol native indicator-plus-rule work against precomputed-feature rule work, with ten trials per concurrency level and five warmups. Both paths verify identical decisions. Its 32-slot semaphore is a synthetic harness boundary, not the HTTP admission implementation. At 1000 logical clients per trial, both modes accepted 320 of 10,000 total attempts and rejected 9680. Their accepted-request p95 values were 26.54 ms and 23.63 ms respectively. These figures omit HTTP, authorization, providers, browser transfer and WASM, so they cannot predict end-to-end user latency. Reported Go heap sampling is process-wide at 1 ms intervals and can miss peaks; allocations include harness activity and do not describe browser or server RSS.

[HTTP admission evidence](../evidence/screening-performance-admission-20261112.json) uses the unchanged `TestStudySyntheticHTTPAdmission` fixture with actual local API handlers and fake dependencies. Each wave creates contexts, holds them, and prepares only the first ten-stock batch. At 1000 attempted users, 32 contexts were admitted, 968 were rejected, 128 stock snapshots were prepared, and 192 preparations returned `SNAPSHOT_CAPACITY`. This is evidence of bounded admission and partial preparation, not successful full-catalog execution for 1000 users. Each concurrency level has one wave; create percentiles include rejected requests and time to response headers, while prepare percentiles describe admitted contexts. No repeated-wave distribution or production capacity is established.

The HTTP test was run without external networking in Docker, with a read-only target/toolchain/module cache, an empty allowlisted environment, two CPUs, 2 GiB RAM, 256 processes, a 1 GiB writable scratch tmpfs, and a 240-second test timeout. The first attempt used a non-executable tmpfs and failed to launch the Go test binary; rerunning with scratch execution enabled passed. Reproduce using the already available image and downloaded module cache (no dependency fetch):

```sh
docker run --rm --network none --read-only --cpus 2 --memory 2g --pids-limit 256 \
  --ulimit nofile=1024:1024 --ulimit fsize=536870912:536870912 \
  --tmpfs /scratch:rw,exec,size=1073741824 \
  --mount "type=bind,src=$PWD/backend,dst=/target,readonly" \
  --mount "type=bind,src=$(go env GOMODCACHE),dst=/gomod,readonly" \
  -w /target golang:1.27.2-bookworm /bin/sh -c \
  'mkdir -p /scratch/home /scratch/tmp /scratch/cache && env -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod GOPROXY=off GOSUMDB=off SIGNALGEN_TEST_PERFORMANCE_OUTPUT=/scratch/admission.json timeout 240 go test ./internal/api/tests -run "^TestStudySyntheticHTTPAdmission$" -count=1 -v && cat /scratch/admission.json'
```

## Optimization decision and next measurements

No product optimization is included: the largest screen stage contains synthetic transport overhead, and the largest backtest compute stage is the outcomes engine outside this task's owned orchestration. These measurements do not justify increasing concurrency, changing grant sequencing, or weakening private-rule protection. Baseline and final product execution are identical, so there is no before/after speedup claim.

1. Measure prepare/provider/database and private scoring stages in an authorized staging environment using a frozen, legally available catalog, including retries, admission rejections and full completion counts. Keep Yahoo and shared services out of synthetic load tests.
2. Profile the real WASM outcome engine on representative horizons and low-end devices before proposing a separately owned engine change. Compare every event/outcome against frozen outputs and rerun Stop, account-change, error and quota tests.
3. Decide multi-instance admission, snapshot capacity/retention and target service levels before a 1000-user design. The current process-local context/snapshot bounds prevent interpreting admission as full-catalog capacity; a faster client cannot resolve that limit.

## Verification and limits

Passed: `npm test`, `npm run typecheck`, `npm run build`, `npm run check:budgets`, seven focused study tests, the six synthetic performance cases, the existing `npm run test:study` browser suite with real WASM/IndexedDB, and the isolated HTTP admission fixture. The existing study browser suite checks partial failure/retry, Stop, storage quota, responsive layouts and forced themes. The benchmark itself invokes orchestration directly and does not measure React rendering or prove UI responsiveness at 500 symbols.

The repository-wide `npm run format:check` failed on five unchanged files: `src/lib/market-news.ts`, `src/styles/foundation-shell.css`, `src/styles/news-journal-details.css`, `src/styles/workspace-compatibility.css`, and `src/styles/workspace-surfaces.css`. They are outside this worker's ownership and were left unchanged; the new benchmark file passes its scoped Prettier check. No backend product files changed. No live Yahoo, premium-provider, Supabase, deployment, physical-device, or production-capacity validation was performed.

## Follow-up acceptance under the formatting exception

The benchmark baseline deliverable is complete under the coordinator's exception for pre-existing formatting debt. Direct comparisons against `3ee6f3aa684e805c78f6f0d9af484c58ee64ae2c` prove `base == HEAD == working tree` for the five flagged files, `package.json`, `package-lock.json`, `vite.config.ts`, `index.html`, and the root `.gitignore`. Every tracked file in the formatter's direct targets (`src`, `vite.config.ts`, and `index.html`) also has identical bytes. Exact Git blob IDs, SHA-256 hashes, byte lengths, and command results are in the [format baseline evidence](../evidence/screening-performance-format-baseline-20261112.json).

Feeding each flagged file's base bytes to locked Prettier 3.9.6 with its original `--stdin-filepath` reproduces exit 1 for all five. The repository-wide `npm run format:check` was rerun and still fails on those same files. Scoped Prettier and syntax checks pass for `tests/browser/screening-performance.cli.js`, and whitespace checks pass from the base through this branch and for the follow-up diff. No formatter configuration or dependency inputs changed.

Original task `task_ba3e40936b3e` retains its failed outcome. Follow-up task `task_2d9810728d89` records acceptance under this benchmark-only exception; the five global formatting issues remain outstanding for separate work. Existing successful tests and measurements are reused because this follow-up changes documentation and evidence only.

No optimization or production-capacity claim is added. The isolated 1000-request result remains 32 admitted contexts, 968 rejected contexts, and 192 snapshot-capacity failures; product code and admission limits remain unchanged.
