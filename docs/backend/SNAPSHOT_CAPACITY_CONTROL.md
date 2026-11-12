# Snapshot capacity control

Study and historical-screen batches now reserve their full requested handle count before fetching data. A capacity refusal returns HTTP 429 `SNAPSHOT_CAPACITY` with `Retry-After: 1` and publishes no new handles from that batch. Provider failures still produce the existing per-symbol partial 200 response when the batch fits the capacity budget.

## Shared accounting and lifecycle

The default limits remain 128 published or reserved handles, 16 per owner, 32 MiB of published plus staged JSON bytes, and a 15-minute published-handle TTL. Study contexts still cap at 32 per handler. Ordinary screening/backtest snapshots and study reservations share the same count, owner and byte checks. Existing active handles are never evicted to admit another batch.

The dataset store reserves at most ten slots in one short critical section. It then prepares at most three symbols concurrently, retaining staged handles privately. Each staged payload counts against the shared byte limit immediately; ordinary publication cannot consume those bytes. Byte size is unknown before fetching, so a batch can still be refused after doing provider work. If any symbol hits byte capacity, the entire new batch is discarded. Successful provider results are published together only after the reservation, request context and staged expiry checks pass.

Provider-only failures remain partial results, including the existing distinction between retryable provider unavailability and non-retryable insufficient history. Missing provider results release their unused slots when the batch commits. The store does not add a waiting queue, increase capacity limits, or move private scoring into a client.

Reservations expire after at most eight seconds (or the shorter snapshot TTL). Cancellation, timeout, study release and completion free their slots and staged bytes. Expiry is pruned on subsequent store operations, matching the existing lazy handle-expiry model. A release for another owner cannot cancel a reservation or delete its handles. The final API checks still reject canceled/expired studies and changed rules; existing session, entitlement, grant and checksum binding remain in place.

An ordinary or previously published study handle keeps its original lifetime. A new prepare that cannot fit alongside active handles is refused without deleting them. Release the active batch before retrying. If a custom per-owner limit is smaller than the requested batch, that whole batch cannot fit; an explicitly requested frozen subset can be retried without changing the limit. The default owner limit accommodates the normal ten-stock batch.

## Synthetic admission comparison

The before run uses integration base `757c7e6c338c7c875d3476a99f5270977c2f0efa` in a disposable source copy. Only test observation fields for complete/partial batch counts were added to that copy; product code is the exact base. The after run uses the same local API fixture with synthetic identity, sessions, entitlements, catalog and daily OHLCV. It creates contexts concurrently, holds them, and prepares their first ten-stock batch. Rejected requests are counted separately from successful users.

The previously observed 1000-request baseline admitted 32 contexts, rejected 968, published 128 snapshots, and returned 192 per-symbol `SNAPSHOT_CAPACITY` failures. With whole-batch reservation, the same wave still admits 32 contexts and rejects 968. It can publish 12 full batches (120 snapshots), then refuse 20 batches (200 requested stock preparations) with retryable 429 responses. The remaining eight slots cannot accommodate another ten-stock batch. This deliberately trades capacity-driven partial results for recoverable batch backpressure; it is not higher throughput or evidence of 1000-user capacity.

The instrumented baseline rerun returned six complete first batches and 26 non-full 200 responses in its 1000-request wave; the after run returned 12 complete first batches, zero non-full 200 responses and 20 batch refusals. A baseline non-full response can include zero successfully prepared stocks; it is not counted as a successful full batch. These distribution counts depend on scheduling, while total baseline snapshots and failures were 128 and 192.

The experiment measures one wave at each logical concurrency of 1, 10, 30, 100 and 1000. It does not traverse entire catalogs or call Yahoo, Supabase, a premium provider, or a deployed service. Latencies are local fixture observations, not production service levels. The exact before/after counts and environment are in the [comparison evidence](../evidence/snapshot-capacity-comparison-20261112.json); check results are in the [validation evidence](../evidence/snapshot-capacity-validation-20261112.json). No speed comparison is made: developer activity and concurrent isolated jobs may contend for CPU, and successful prepare latency excludes rejected batches after the change.

## Reproduce safely

Use the existing Go image and downloaded module cache. This command mounts only the backend source and module cache read-only, disables external networking, starts from an explicit environment allowlist, and limits scratch space and execution resources. It runs the full Go suite, focused race tests, vet, and the opt-in HTTP admission fixture; no `.env` file is loaded.

```sh
docker run --rm --network none --read-only --cpus 2 --memory 2g --pids-limit 256 \
  --ulimit nofile=1024:1024 --ulimit fsize=536870912:536870912 \
  --tmpfs /scratch:rw,exec,size=2147483648 \
  --mount "type=bind,src=$PWD/backend,dst=/target,readonly" \
  --mount "type=bind,src=$(go env GOMODCACHE),dst=/gomod,readonly" \
  -w /target golang:1.27.2-bookworm /bin/sh -c \
  'mkdir -p /scratch/home /scratch/tmp /scratch/cache && env -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod GOPROXY=off GOSUMDB=off SIGNALGEN_TEST_PERFORMANCE_OUTPUT=/scratch/admission.json timeout 420 /bin/sh -c '\''go test ./... -count=1 && go test -race ./internal/dataset ./internal/api/tests -count=1 && go vet ./internal/dataset ./internal/api/backtests ./internal/api/tests && cat /scratch/admission.json'\'''
```

For a non-race admission measurement, use the same isolation command with only `go test ./internal/api/tests -run "^TestStudySyntheticHTTPAdmission$" -count=1 -v && cat /scratch/admission.json` as the inner shell payload. The combined validation command above runs the fixture again under the race detector, which can overwrite its output with instrumented timings; do not compare those timings with a non-race run.

The old failure can be reproduced from a disposable `git archive` of the integration base using its original `TestStudySyntheticHTTPAdmission` command. Adding complete/partial counters to that test observer does not change admission or preparation behavior. The current observer also accepts explicit batch-capacity 429 responses and records their count and requested stocks; old compact evidence files retain their original meaning.

## Validation scope

Focused tests cover mixed-owner count limits, ordinary snapshots sharing the reservation budget, staged-byte accounting, byte overflow rolling back the entire new batch, retry after release/cancel/timeout/expiry, active-handle preservation, foreign-owner release, and genuine provider partial failure. Existing API tests exercise frozen retries, cancellation during provider work, owner/session isolation, entitlements, grants and private scoring. The full `go test ./...` suite passed before adding the dedicated HTTP recovery test; final race tests and vet then passed with that test included. Scoped gofmt and whitespace checks passed. The full suite also validated the updated OpenAPI document.

No frontend, core formulas, collection, market-data cache, migration, or admission-limit constants are changed. Browser behavior relies on the existing study orchestration's bounded 429 retries and explicit failed-batch recovery; this backend change does not add UI. Multi-instance coordination, provider service levels, fairness under sustained load, and production capacity remain separate work.
