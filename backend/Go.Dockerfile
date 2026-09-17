FROM golang:1.26.0-bookworm AS source

WORKDIR /workspace/backend

COPY backend/go.mod ./go.mod
COPY backend/core ./core
COPY backend/cmd ./cmd


FROM source AS test

RUN go test ./...


FROM source AS wasm-build

RUN mkdir -p /out \
    && GOOS=js GOARCH=wasm go build -trimpath -o /out/signalgen_core.wasm ./cmd/wasm \
    && cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" /out/wasm_exec.js


FROM scratch AS wasm-artifact

COPY --from=wasm-build /out/ /
