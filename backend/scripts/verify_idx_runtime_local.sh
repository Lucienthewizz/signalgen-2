#!/bin/sh
# Run from repository root. Compiled-binary smoke only, never exact-image evidence.
set -eu
test -f backend/Go.Dockerfile
module_cache=$(go env GOMODCACHE)
docker image inspect golang:1.27.2-bookworm >/dev/null
docker run --rm --network none --read-only --cpus 2 --memory 1536m --pids-limit 128 \
  --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 \
  --ulimit nofile=1024:1024 --ulimit fsize=134217728:134217728 \
  --tmpfs /scratch:rw,exec,size=1073741824,mode=1777 \
  --mount "type=bind,src=$PWD/backend,dst=/target,readonly" \
  --mount "type=bind,src=$module_cache,dst=/gomod,readonly" \
  -w /target golang:1.27.2-bookworm /bin/sh -c '
    mkdir -p /scratch/home /scratch/tmp /scratch/cache
    exec env -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home \
      TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod \
      GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local CGO_ENABLED=0 \
      SIGNALGEN_TEST_COLLECTOR_BINARY=/scratch/signalgen-collect-idx \
      timeout 180 /bin/sh -c '\''
        go build -trimpath -o /scratch/signalgen-collect-idx ./cmd/collectidx &&
        sha256sum /scratch/signalgen-collect-idx &&
        go test ./internal/collection ./cmd/collectidx -count=1 -v &&
        go vet ./internal/collection ./cmd/collectidx
      '\''
  '
