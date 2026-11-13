# Publication-aware IDX archive cache

`idx_store` cache requests now select the published generation before looking up cached candles. The cache key and upstream read share the same immutable archive view. A completed A→B publication is visible to the next latest or history request without waiting for the five-minute candle TTL; an already-running A request finishes with A data.

## Pinned request boundary

The optional `marketdata.SnapshotProvider` returns an opaque revision and a provider view together. `CachedProvider.Candles` resolves it once before its bounded symbol workers start; every instrument in that call uses the same view. `DailyHistory` resolves it once for its single-instrument range. The flight receives that pinned provider directly, so a later pointer update cannot put B data under an A cache key.

Providers without this interface keep their existing TTL/coalescing path. Keys still separate instrument, provider symbol, exchange/currency, timeframe, output size and historical window; history keys now retain RFC3339 nanoseconds instead of merging distinct subsecond range boundaries. No API schema, candle filtering or financial calculation changes.

Separate history calls can select different generations if publication happens between them. This change pins cache-method requests, rather than adding a transaction across separate dataset preparation calls. Each acquired snapshot remains immutable afterward.

## Bounded resolution and provenance

`StoreProvider` reads and validates the regular `current.json` pointer on every logical request, including hot cache hits. Reads are bounded to 4096 bytes with strict JSON/schema/path validation; revisions are limited to 128 non-NUL bytes. Missing, malformed, linked, oversized or invalid publication targets return an error before a hot-cache lookup can succeed. A failed collection that leaves the valid A pointer intact continues to serve A, as intended.

The store retains one metadata view for the last successfully validated immutable generation; invalid publication pointers return errors instead of falling back to that view. It loads the catalog/report only when the generation changes, rather than parsing the entire catalog on every hot request. In-flight requests retain their own older view; the store does not accumulate a map of all generations. This relies on the existing contract that published generation directories are immutable. It is not an in-place archive-tamper monitor: selected snapshot files retain their existing checksum/validation on cold reads, and metadata is reused within a generation.

Cache budgets remain unchanged: five-minute maximum TTL, 64 combined latest/history entries, 32,000 cached candles, eight global flights, at most three per-batch waits and a 15-second shared fetch timeout. Old and new generation keys share those same limits. Request cancellation stops that caller's wait; shared work retains its independent timeout and remains available to other waiters. Returned candle/warning slices are cloned as before.

Per-series warnings retain the selected generation and fixed archive dates/coverage, so an A result does not acquire B provenance after publication. The generic store warning describes a published archive and no longer says publication is hidden by the shared TTL. It does not claim that a scheduler is active. Existing private dataset bytes, checksums, handles and grant bindings are not rewritten by a public cache refresh.

Retention, publication writing, collection/resume logic, authorization and capacity limits are unchanged. The existing retirement grace still has to exceed request duration; retaining an in-memory archive view does not prevent its files from being removed after the permitted retention window.

## Synthetic measurements

Before source is `4b2173c4199345770d58cbdcf927bfd3f193fada`; only the new test observer was copied into its disposable source snapshot. Both phases use real `Sync` publication and archive readers with a synthetic 500-symbol catalog and 40 daily candles per symbol. Selected prices are deliberately 101 in A and 201 in B. No real catalog, Yahoo request or deployed service is involved.

Each mode has three warmups, then fifteen samples of twenty calls. The figures below are medians/p95 of sample mean time per call, not individual-request tail latency. With fifteen samples, nearest-rank p95 is the largest sample mean. Both runs use the existing Go 1.27.2 Linux arm64 image, GOMAXPROCS=1, two-CPU quota and 2 GiB RAM on an Apple M5 host. Own measurement runs were sequential and separated in wall time; the after run was repeated on final source after validation. Other host development load was not controlled. Files are on bounded container tmpfs, so these are not physical-disk or production latency estimates.

| Mode | Before median ms | After median ms | Before p95 ms | After p95 ms |
| --- | ---: | ---: | ---: | ---: |
| Direct store latest read | 0.87901 | 0.04597 | 0.93906 | 0.05483 |
| Hot latest cache | 0.00075 | 0.00331 | 0.00090 | 0.00393 |
| Cold latest cache | 0.88827 | 0.04629 | 0.96739 | 0.05777 |
| Hot history cache | 0.00036 | 0.00315 | 0.00070 | 0.00744 |

A cold cache here is a new `CachedProvider` with an already-initialized store, not cold process startup or uncached disk. The new hot-cache cost includes a pointer read/validation on every request, roughly 3–4 microseconds in this fixture. The direct-store benchmark changed from 919,224 ns/op, 1,509,359 B/op and 3,723 allocations/op to 52,934 ns/op, 33,979 B/op and 102 allocations/op by reusing validated metadata. The before CPU profile is dominated by JSON decoding, consistent with repeated catalog/report resolution. These numbers do not establish production throughput or a memory requirement.

In the publication transition, the old warm cache still returned 101 for latest and history even after B was published. The new cache returned 201 for both immediately, while the retained A result stayed 101. The first changed-generation latest request took 1.27 ms in this one observed transition, including new metadata validation and a cold series read. The old stale hit took 0.04 ms and is not a valid speed comparison because it returned the old generation.

Raw samples and isolation details are in the [performance evidence](../evidence/publication-aware-cache-performance-20261113.json); CPU profile summaries are [before](../evidence/publication-aware-cache-profile-before-20261113.txt) and [after](../evidence/publication-aware-cache-profile-after-20261113.txt).

## Verification

Real synthetic archive tests warm both paths, publish B, verify immediate B reads, preserve a frozen owner-bound A dataset/checksum, reject foreign-owner content access and check slice isolation. Barrier-controlled real archive tests publish B while A latest/history reads are blocked, then verify each result keeps its selected generation. Additional cache tests cover coalescing with a canceled waiter, failed snapshot resolution despite a hot entry, one snapshot per multi-symbol call, timeframe/provider-symbol/range separation, nanosecond windows, invalid revisions and budgets across ten revision changes. Existing TTL, capacity, timeout, error, clone, archive validation and retention tests remain in the run.

Affected collection/marketdata tests, dataset and API regressions, their race tests and vet passed in bounded offline Docker; `cmd/api` compiled without starting an API or opening a real database. Final source hashes and exact commands/results are in the [validation evidence](../evidence/publication-aware-cache-validation-20261113.json). The existing API construction selects `StoreProvider` for `idx_store` and wraps it in one `CachedProvider`; runtime configuration is unchanged.

Graph-first discovery used project `signalgen-publication-cache`, with exact-path coverage checks and direct current-source/diff review for new or changed files. Coverage is best-effort evidence, not an exhaustive impact proof.

## Reproduce without live services

Use the existing local OrbStack context, image and module cache; do not pull an image or download modules. Make a source-only disposable snapshot so ignored environment files and credentials are not exposed. From the repository root, copy only these task-owned Go files over a `git archive` of the base: `marketdata/{cache,history_cache,snapshot,snapshot_test}.go` and `collection/{sync,store_cache,store_cache_test,store_cache_benchmark_test}.go`, under `backend/internal`. Mount that prepared backend at `/target` read-only.

The verification run uses an empty allowlisted child environment, a read-only root/toolchain/source, scratch-local home/temp/cache, no external network or host Docker socket, two CPUs, 2 GiB RAM, 256 PIDs, 1024 open files, a 256 MiB file-size limit, a 2 GiB scratch tmpfs and a 480-second wall timeout:

```sh
perf_source=$(mktemp -d /tmp/signalgen-publication-current.XXXXXX)
git archive 4b2173c4199345770d58cbdcf927bfd3f193fada backend | tar -x -C "$perf_source"
for file in marketdata/cache.go marketdata/history_cache.go marketdata/snapshot.go marketdata/snapshot_test.go collection/sync.go collection/store_cache.go collection/store_cache_test.go collection/store_cache_benchmark_test.go; do
  cp "backend/internal/$file" "$perf_source/backend/internal/$file"
done
docker --context orbstack run --rm --pull=never --network none --read-only \
  --cpus 2 --memory 2g --pids-limit 256 --ulimit nofile=1024:1024 \
  --ulimit fsize=268435456:268435456 --tmpfs /scratch:rw,exec,size=2147483648 \
  --mount "type=bind,src=$perf_source/backend,dst=/target,readonly" \
  --mount "type=bind,src=$(go env GOMODCACHE),dst=/gomod,readonly" \
  -w /target golang:1.27.2-bookworm /bin/sh -ec '
    mkdir -p /scratch/home /scratch/tmp /scratch/cache
    env -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod GOPROXY=off GOSUMDB=off GOMAXPROCS=1 timeout 480 /bin/sh -ec '\''
      go test ./internal/collection ./internal/marketdata ./internal/dataset ./internal/api/... -count=1
      go test -race ./internal/collection ./internal/marketdata ./internal/dataset ./internal/api/... -count=1
      go vet ./internal/collection ./internal/marketdata ./internal/dataset ./internal/api/...
      go build -o /scratch/signalgen-api ./cmd/api
    '\''
  '
```

For measurements, use the same isolation with `SIGNALGEN_PUBLICATION_PERF_OUTPUT=/scratch/report.json` and run only `go test ./internal/collection -run '^TestPublicationCacheMeasurements$' -count=1`, then print `/scratch/report.json`. Do not carry that output flag into race tests. For a two-second CPU profile use `go test ./internal/collection -run '^$' -bench '^BenchmarkPublicationStoreResolution$' -benchtime=2s -cpuprofile=/scratch/cpu.pprof -o /scratch/collection.test`, followed by `go tool pprof -top -nodecount=12 /scratch/collection.test /scratch/cpu.pprof`. The measurement runs used a 64 MiB file-size bound, a 240-second wall limit and 1 GiB scratch in each phase, recorded in the raw evidence.

Before/after measurements require separate source snapshots of the base and this branch, with only `store_cache_benchmark_test.go` added to the base. No scheduler is activated, no real archive is pruned, and no cloud deployment or real IDX coverage is claimed.
