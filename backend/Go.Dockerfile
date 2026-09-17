FROM golang:1.26.0-bookworm AS source

WORKDIR /workspace/backend

COPY backend/go.mod backend/go.sum ./
COPY backend/core ./core
COPY backend/cmd ./cmd
COPY backend/internal ./internal


FROM source AS test

RUN go test ./...


FROM source AS api-build

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/signalgen-api ./cmd/api \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/signalgen-admin ./cmd/admin \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/signalgen-healthcheck ./cmd/healthcheck


FROM debian:bookworm-slim AS api-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home signalgen \
    && mkdir -p /data \
    && chown signalgen:signalgen /data

COPY --from=api-build /out/signalgen-api /usr/local/bin/signalgen-api
COPY --from=api-build /out/signalgen-admin /usr/local/bin/signalgen-admin
COPY --from=api-build /out/signalgen-healthcheck /usr/local/bin/signalgen-healthcheck
COPY backend/core/testdata/default_scalping_v1.json /usr/share/signalgen/fixtures/default_scalping_v1.json

USER signalgen
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 CMD ["signalgen-healthcheck"]
CMD ["signalgen-api"]


FROM source AS wasm-build

RUN mkdir -p /out \
    && GOOS=js GOARCH=wasm go build -trimpath -o /out/signalgen_core.wasm ./cmd/wasm \
    && cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" /out/wasm_exec.js


FROM scratch AS wasm-artifact

COPY --from=wasm-build /out/ /
