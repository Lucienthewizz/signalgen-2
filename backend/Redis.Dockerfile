FROM redis:7.4-alpine@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe
COPY --chmod=0555 backend/deploy/redis-entrypoint.sh /usr/local/bin/signalgen-redis
USER redis
ENTRYPOINT ["/usr/local/bin/signalgen-redis"]
