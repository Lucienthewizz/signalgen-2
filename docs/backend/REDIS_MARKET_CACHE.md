# Shared Redis market-data cache

Redis is an optional cache for public OHLCV, not the historical archive or the
source of account permissions. The active path is:

```text
session / entitlement / ownership checks
  -> bounded process-local cache
  -> shared Redis cache
  -> configured Yahoo or historical-archive provider
  -> owner-bound dataset -> browser WASM -> server rule evaluation
```

Only successful, validated provider data is cached. Rules, bearer tokens,
sessions, subscription decisions, dataset handles, grants and journal data are
not stored in Redis. Each API request retains the existing access checks.

## Local setup

From the repository root, `docker compose up --build -d go-api` starts the API
and its `market-cache` dependency. The Redis image is pinned by digest. Redis
has no published host port and runs on a private internal cache network.
Its memory eviction budget is 64 MiB (`allkeys-lru`), with a separate 128 MiB
container memory limit. Snapshots/AOF are disabled because every cached value
can be reconstructed; no archive or user-data volume is attached.

The default Compose file passes `SIGNALGEN_REDIS_URL=redis://market-cache:6379/0`
to the API. The local offline runtime Compose file remains opt-in and unchanged;
when using a custom deployment, attach both services to a private network and
provide its reachable Redis URL explicitly.

For a host-run API, use an explicitly secured/reachable Redis endpoint in
`SIGNALGEN_REDIS_URL`. Leaving this variable empty disables Redis. Do not publish
the private Compose Redis to the internet. Passwords and connection URLs belong
in server-side deployment variables, never in frontend configuration or Git.

## Railway

Create a Redis service and pass its private connection URL to the Go service as
`SIGNALGEN_REDIS_URL`. Keep both in the same region/private network. Use
`rediss://` and verified TLS when connecting over an external TLS endpoint.
Configure the Redis service's memory budget and eviction policy there too;
the local Compose limits do not automatically transfer to Railway.

`SIGNALGEN_REDIS_NAMESPACE` defaults to `signalgen`. Use a distinct namespace
for deployments that should not share provider data. The actual namespace
also hashes the provider mode, Yahoo base URL and archive path. Individual keys
hash the existing symbol, provider symbol, market, currency, interval, output
size/range and immutable archive revision. The `market:v1` prefix is the cache
encoding version, not the API/WASM contract version.

## Freshness and failure behavior

- TTLs retain the existing interval policy: 30s for 1m, 60s for 5m, 180s for
  15m, and at most 300s for 1h/1d and historical ranges.
- Each value carries an absolute expiry. Reading it into another process does
  not restart that TTL. Range timestamps and quality warnings survive encoding.
- A shared hit is revalidated before use. Corrupt, expired, oversized,
  wrong-symbol or incompatible-version data becomes a miss, not `No match`.
- Redis operations have a 250ms context deadline, a bounded eight-connection
  pool and no command retries. An error pauses Redis access for five seconds;
  provider/RAM fallback continues. Redis is not a readiness dependency.
- Entries are bounded to 2 MiB. Reads request at most that size plus one byte.
- Existing local fetch coalescing and provider concurrency limits remain.
  Concurrent cold misses in different API processes can still fetch separately;
  this change does not add a distributed lock or global provider rate limiter.
- Minute summaries report Redis byte hits, misses and failures without printing
  keys, values or connection credentials. A byte hit can still fail validation
  and fall back to the provider.

Restarting or evicting this cache must not remove the durable archive, rules or
journals. Redis alone does not eliminate the first Yahoo download, database
round trips, WASM startup or rule-evaluation network latency. End-to-end speed
needs separate measurement; cache integration is not a performance guarantee.

## Verification

Unit tests cover cross-instance reuse, preserved quality/range metadata,
unchanged expiry, interval/output-size/window/publication separation, corrupt
data, Redis failure and provider failure. The opt-in integration test uses a
disposable Redis and removes only its own random namespace:

```sh
cd backend
SIGNALGEN_TEST_REDIS_URL=redis://127.0.0.1:16379/0 go test -race ./internal/marketdata
```

Never point that test variable at a shared production cache. Integration tests
without the variable are explicitly skipped. No database migration or engine,
WASM, feature-vector or WebSocket protocol change is required.

References: [Redis Go client](https://redis.io/docs/latest/develop/clients/go/),
[production settings](https://redis.io/docs/latest/develop/clients/go/produsage/),
[eviction](https://redis.io/docs/latest/reference/eviction/).
