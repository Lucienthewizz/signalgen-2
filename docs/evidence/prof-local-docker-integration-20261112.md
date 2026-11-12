# Local Docker and study optimization integration

The combined source is `2c4ad1dfbb6a045b7d5a6968eacf971b6f3b81e2` on
`frontend/prof-revisions-integration`. The final child commit changes documentation
and evidence only. Its exact delivery SHA is recorded by the Git remote, rather
than embedded into its own contents.

The branch preserves integration base `5bb111d626625bede93e4f7d590c19227a247699`
and merges runtime `9137d7b8b4dd42c7ed3290dd8d8b3b0625aefc92` through `49fbcc5`,
then optimization `f2928c8e7558a8d97a9bfd8ce09704b11be6eeae` through `2c4ad1d`.
No product fix or conflict resolution was needed. Older branches and historical
reports remain intact. [Structured results](prof-local-docker-integration-20261112.json)
include commands, hashes and browser reports.

## New runtime identity

The new local image is
`sha256:cf5e1397b73b4e463b360897f19f5ac0fe02470288b025dd1114a614efa85a50`,
with convenience tag `signalgen-local-runtime:2c4ad1dfbb6a`. It contains the
optimized source, unlike the earlier `81b7976…` image.

The helper compiled all five application binaries from verified tracked source:
API, admin, catalog audit, healthcheck and IDX collector. All packaged bytes match
the rebuilt digests; each executable is root-owned mode `0555`, with runtime UID
`10001:10001`. Runtime data came from reviewed local input
`sha256:f1baf33b1e06c6a7b54f6226cf758785efd2efe99a358c9f613aa906da2077f4`;
only CA certificates, passwd and group were copied. No inherited old binary was
used. The final recipe starts from scratch and performs COPY only.

The toolchain is local image
`sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61`.
Compilation and target execution used no network, read-only source/module cache
and root filesystem, an empty allowlisted child environment, dropped capabilities,
no-new-privileges, scratch HOME/temp/cache, CPU/RAM/PID/file/open-file bounds and
wall deadlines. Compilation used two CPUs, 2 GiB RAM, 256 PIDs and a 2 GiB scratch
tmpfs with a 360-second target deadline. No Docker socket or credentials entered
a target container. Parent packaging executes the reviewed COPY-only recipe.

From the repository root, reproduce the local package and its checks with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/test_local_runtime.py
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/build_local_runtime.py
```

Three preflight tests pass. The image passes collector help, synthetic read-only
catalog validation and `TestCollectorRuntimeSmoke`: incremental publication,
read-only archive access and prune dry-run. Root/catalog write attempts and a
missing bind source are rejected. Compose config passes using an explicit empty
interpolation/service env file and synthetic paths; it preserves the API's
read-only published-store mount and collector's separate writable state boundary.
No authenticated API was started. See [local procedure](../backend/LOCAL_DOCKER_RUNTIME.md)
for operator commands and the exact boundary of this packaging path.

## Combined acceptance

| Check | Result |
| --- | --- |
| `npm test` | 262 passed, zero failures/skips |
| `npm run typecheck` | Pass |
| `npm run format:check` | Full source check passes; old five-file debt was already repaired in the integration base |
| `npm run build` and `npm run check:budgets` | Pass; entry JS gzip 96,905 bytes, workspace static JS gzip 163,754 bytes, entry CSS gzip 64,584 bytes |
| `go test ./core -count=1` | Pass, including all 29 complete canonical result/error golden comparisons |
| `go test -race ./core -count=1`; `go vet ./core` | Pass in bounded offline Docker |
| Matching Go/WASM/runtime manifest | Rebuilt from this source; public and production-dist sizes/digests verified |
| Real browser golden comparisons | All 29 complete result/error hashes pass; timing loops disabled |
| General browser suite | Pass: ten workspace routes at two widths in dark theme, public/account routes, history/evidence/CSV and expired-session cleanup |
| Market-screen and study suites | Pass with real WASM and synthetic API/account/provider decisions |
| Evaluation-options and target-hit suites | Pass at 1440/390 px in dark/forced-light states, including keyboard, error/loading/empty and CSV assertions |
| Snapshot overload suite | Eight cases pass: screen/study × 1440/390 px × dark/forced light, actual HTTP 429 then automatic/manual recovery, bounded retries, keyboard Stop, no stale results and owner isolation |
| `git diff --check` and scoped evidence validation | Pass |

Frontend commands ran in `frontend/web`. Browser commands used an unused owned
Vite port 5181 and isolated contexts:

```sh
export SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5181
export SIGNALGEN_TEST_PLAYWRIGHT_CLI=/Users/lucienyudistirapurnawarman/.codex/skills/playwright/scripts/playwright_cli.sh
npm run test:browser
npm run test:market-screen
npm run test:study
node tests/browser/evaluation-options.mjs
node tests/browser/target-hit-metrics.mjs
node tests/browser/snapshot-overload.mjs
```

No build ran alongside Vite. Native core tests, race/vet, fixture export and WASM
build used the same verified source copy and immutable Go toolchain with read-only
mounts, no network, two CPUs, 2 GiB RAM, 128 PIDs, 2 GiB scratch, 128 MiB file limit,
1024 open files and a 360-second target deadline. Child env allowed only toolchain
PATH, scratch HOME/TMPDIR/GOCACHE, read-only GOMODCACHE, GOPROXY/GOSUMDB off and
GOTOOLCHAIN local. WASM build used `GOOS=js GOARCH=wasm go build -trimpath` and
`go run ./cmd/wasmmanifest`. Parent transfer allowed four named regular artifacts,
each under 16 MB, before verifying manifest sizes/digests. The temporary fixtures
were removed after browser verification.

For browser golden checks, the existing `signal-study-optimization.cli.js` was
loaded into a fresh real Playwright context with only its performance-loop
condition disabled in memory. All assertions, 29 inputs and expected hashes were
preserved. No new benchmark was run and no measurements are inferred from this
correctness pass.

## Evidence reuse and remaining limits

Dataset/API, cache, collection and deployment-unit source paths are unchanged
against `5bb111d`; their earlier regression/race/vet evidence in
[the preceding integration](prof-revisions-followup-20261112.md) is reused, not
reported as rerun. The new combined core/schema concern is checked by native
and real-WASM golden results plus metric/overload browser suites. Private scoring,
output fields and collection policies remain unchanged.

Graph project `browser_regression_integration`, generation
`2026-11-12T14:25:07Z`, reports metadata matches/no recorded issue for the core
and golden-test paths. Scripts/docs are excluded and Dockerfile is not tracked;
those files were read directly. Coverage is best effort, not proof of completeness.

The optimization worker's paired synthetic timings remain tied to its original
commits/environment in [the optimization report](../backend/SIGNAL_STUDY_OPTIMIZATION.md).
Dense 10-symbol/1000-candle medians were 90.04→25.03 ms native and 440.50→126.20 ms
WASM. The 500-symbol outcomes stage was 1526→1213 ms; other-stage variance prevents
attributing the entire total difference to this cursor change. These samples do
not demonstrate production throughput or 1000-user capacity.

Local offline packaging is verified. A clean build of the unmodified production
`Go.Dockerfile` remains unverified under the required per-RUN controls. External
Supabase API health, real IDX coverage/freshness, live Yahoo, premium API
specification/cost and staging/physical-device/full-user-load proof remain open.
Local/Docker is selected; durable-volume/multi-instance topology still needs an
operator decision. No image registry push, cloud/production operation, personal
env read, real data download or Linux timer activation occurred. macOS does not
provide the claimed Linux unit-tooling evidence. Daily hit timestamps identify
candles, not intraday fills; today's catalog is not a historical point-in-time
universe. The [remaining-gap snapshot](../backend/PROF_REMAINING_GAPS.md) keeps these
operational/research limits separate from implemented behavior.
