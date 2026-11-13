# Independent cache-review execution evidence

Reviewed source: `989db437def01951abce6aa7b23b2d70ca886f91`, ancestor
`4b2173c4199345770d58cbdcf927bfd3f193fada`. Delivery branch:
`frontend/publication-cache-independent-review`. Production source is unchanged;
this branch adds only review documentation and reproduction probes. No scheduler
or integration branch was checked out or merged.

The [review report](../backend/PUBLICATION_CACHE_INDEPENDENT_REVIEW.md) found no
demonstrated new defect within its stated scope. This is not full audit or
whole-application approval. [Structured evidence](publication-cache-review-20261113.json)
records exact hashes, test summaries and unresolved deployment conditions.

## Actual checks

| Command, in isolated `/target` | Result |
| --- | --- |
| `go test ./internal/marketdata -run 'Test(Snapshot\|Cache\|RangeCache\|Interval\|IndependentReview)' -count=5 -timeout=90s -v` | Pass |
| `go test ./internal/collection -run 'Test(StorePublication\|StoreInvalidPublication\|RealPublication\|IndependentReview\|Retention\|SyncFailure)' -count=5 -timeout=90s -v` | Pass |
| `go test ./internal/dataset -count=1 -timeout=90s` | Pass |
| Corresponding marketdata and collection selections with `-race -count=3` | Pass |
| `go test -race ./internal/dataset -count=1 -timeout=90s` | Pass |
| `go vet ./internal/marketdata ./internal/collection ./internal/dataset` | Pass |
| `go test -race ./internal/marketdata ./internal/collection -run '^TestIndependentReview' -count=1 -timeout=90s -v` | Pass after gofmt-only changes to the final retained probe bytes |
| Source Git/blob checks, JSON/relative links, scope/credential/diff checks | Pass |

The new [collection probe](publication-cache-review-collection_test.go.txt) has
three tests: publication during a five-symbol latest call; invalid warm pointers
and corrupt newly selected metadata; metadata reuse and separate history views.
The new [marketdata probe](publication-cache-review-marketdata_test.go.txt) checks
global flight capacity, caller cancellation and shared timeout for both latest
and history generations. The probes reuse the worker's deterministic price and
publication fixtures, but independently add assertions for those boundaries.
They never fabricate API decision output or contact a live provider.

Existing worker tests were also executed independently, including pinned
in-flight A/B reads, coalescing, revisions, aliasing, pointer rejection and frozen
owner dataset/checksum. Dataset tests use local fixtures, not a real Supabase
project or new PostgreSQL stack. Grant/API source is unchanged; broader API/build
results remain worker evidence and were not relabeled as independent execution.

## Isolation and reproduction

The Docker server passed a five-second local `orbstack` preflight. Tests used
local immutable image
`sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61`:
network none, read-only source/toolchain/root, non-root UID/GID 65534, dropped
capabilities, no-new-privileges, no persistent container logging, two CPUs,
2 GiB RAM, 256 PIDs, 1024 open files, 128 MiB file-size limit and 2 GiB scratch
tmpfs. Child env was empty except toolchain PATH, scratch HOME/TMPDIR/GOCACHE,
read-only GOMODCACHE, GOPROXY/GOSUMDB off and GOTOOLCHAIN local. The overall target
deadline was 360 seconds, with a 375-second parent bound and bounded output.
No dependency/image download, Docker restart or host socket/credentials exposure
occurred. Only exact own containers and scratch paths were eligible for cleanup.

From the repository root, prepare a source-only snapshot and explicit test-only
overlays; do not mount the original backend with ignored personal files:

```sh
review_source=$(mktemp -d /tmp/signalgen-cache-review.XXXXXX)
git archive 989db437def01951abce6aa7b23b2d70ca886f91 backend | tar -x -C "$review_source"
cp docs/evidence/publication-cache-review-collection_test.go.txt \
  "$review_source/backend/internal/collection/independent_review_probe_test.go"
cp docs/evidence/publication-cache-review-marketdata_test.go.txt \
  "$review_source/backend/internal/marketdata/independent_review_probe_test.go"
```

Use the cached module path reported by trusted `go env GOMODCACHE`, mounted
read-only at `/gomod`. For example, this reproduces the final probe race check:

```sh
docker --context orbstack run --rm --pull=never --network none --read-only \
  --user 65534:65534 --cpus 2 --memory 2g --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges --log-driver none \
  --ulimit nofile=1024:1024 --ulimit fsize=134217728:134217728 \
  --tmpfs /scratch:rw,exec,size=2147483648,mode=0700,uid=65534,gid=65534 \
  --mount "type=bind,src=$review_source/backend,dst=/target,readonly" \
  --mount "type=bind,src=$(go env GOMODCACHE),dst=/gomod,readonly" \
  --entrypoint /usr/bin/env \
  sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 \
  -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home TMPDIR=/scratch/tmp \
  GOCACHE=/scratch/cache GOMODCACHE=/gomod GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
  timeout 360 /bin/sh -ec '
    mkdir -p /scratch/home /scratch/tmp /scratch/cache
    cd /target
    go test -race ./internal/marketdata ./internal/collection -run "^TestIndependentReview" -count=1 -timeout=90s -v
  '
```

The other test selections above ran under the same controls. The first check
used the original probe whitespace, then both retained probes were formatted in
a separately bounded offline Go image and the final probe bytes rechecked with
race. Production source remained byte-identical throughout.

Graph index-status, symbol and coverage requests returned `Transport closed`.
Exact current source/diffs were used instead; no metadata-completeness claim is
made. The worker's validation/performance source-blob maps were checked against
`989db437` before their broader results and synthetic measurements were cited.
No new performance benchmark, browser suite, scheduler run, integration merge or
real-provider operation was performed. Filesystem trust/slow-storage and
retention assumptions remain in the review report.
