# SignalGen MVP — Target API & Worker Contract

Versi desain 0.1 · 16 September 2026 · **Proposed contract, partially implemented.** [`openapi.yaml`](openapi.yaml) documents only the implemented Go surface and wins for current runtime integration; this file retains proposed routes and policy decisions. Changes require FE+BE review and versioning.

Implementation checkpoint 18 September 2026: Go API currently implements
`GET /health`, `GET /ready`, `POST /api/v1/sessions`, `GET /api/v1/capabilities`, and
`DELETE /api/v1/sessions/current`. `GET /api/v1/account/me` is also available
with the currently implemented profile, feature, session, and device fields.
`GET /api/v1/account/sessions` and `DELETE /api/v1/account/sessions/{id}`
provide an owner-scoped session list and idempotent revoke; cursor pagination
remains future work. Active-session limits are configurable and enforced
transactionally; creating a new session for the same installation replaces the
previous one.
Dataset routes currently serve only the checksum-verified synthetic
`BBCA.JK` screening fixture to accounts with an active `screener` grant.
`POST /api/v1/compute-grants` is implemented for the frozen screening baseline
and rejects mismatched dataset, rule, engine, or schema versions.
`GET /api/v1/rules` and `GET /api/v1/rules/{id}` expose that same frozen
baseline as a read-only system rule to accounts with `screener`; user rule
mutations remain unimplemented.
Browser integration supports an exact-origin CORS allowlist configured through
`SIGNALGEN_CORS_ORIGINS`; wildcard origins are rejected.
The server-side operator role guard is implemented and composes bearer,
app-session, active-account, and database-role checks. No public operator route
is registered yet. The first active operator can be bootstrapped exactly once
through local CLI tooling; the role change and its actor/reason/before/after
state are recorded atomically in the append-only audit table.
This checkpoint is a subset, not a claim
that the remaining proposed routes are available.

## 1. Conventions

- Base target: `/api/v1`; JSON UTF-8; HTTPS production; UTC RFC 3339 timestamps.
- Private request: `Authorization: Bearer <supabase_access_token>` and, except bootstrap exemptions, `X-App-Session: <opaque_session_token>`.
- App-session token is a secret, not the public session/device ID; never URL/log it.
- Request mutation supports `Idempotency-Key` where noted; updates support `If-Match: <version>` or explicit version.
- List: cursor + limit (default 25, max 100), deterministic ordering.
- Money/quantity: decimal string. OHLC values: decimal string on wire; conversion to core format is versioned and tested.
- Unknown enum/field policy is schema-specific; writes reject unknown fields. IDs opaque; clients do not infer ownership.
- Protected/private responses: `Cache-Control: private, no-store`. Versioned WASM public asset may use immutable cache.

Success envelope is resource-specific. Error envelope:

```json
{
  "error": {
    "code": "ENTITLEMENT_REQUIRED",
    "message": "Akses backtest belum aktif.",
    "request_id": "req_opaque",
    "field_errors": [{"field": "date_to", "code": "INVALID_RANGE", "message": "..."}]
  }
}
```

Stable HTTP/code minimum:

| HTTP | Codes |
| --- | --- |
| 400/422 | `INVALID_REQUEST`, `INVALID_RULE`, `INVALID_RANGE`, `UNSUPPORTED_CAPABILITY` |
| 403 (preflight) | `ORIGIN_NOT_ALLOWED` |
| 401 | `AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_EXPIRED` |
| 403 | `ACCOUNT_SUSPENDED`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `ENTITLEMENT_REQUIRED`, `ROLE_REQUIRED` |
| 404 | `RESOURCE_NOT_FOUND` (consistent for non-owner/private missing) |
| 409 | `VERSION_CONFLICT`, `DEVICE_LIMIT_REACHED`, `IDEMPOTENCY_CONFLICT`, `POSITION_INSUFFICIENT` |
| 413/429 | `DATASET_LIMIT_EXCEEDED`, `RATE_LIMITED` |
| 502/503 | `PROVIDER_UNAVAILABLE`, `SERVICE_UNAVAILABLE` |

## 2. Auth/account/session routes

Legacy `/api/auth/*` remains unchanged during migration. Target:

| Method | Route | App session | Purpose |
| --- | --- | :---: | --- |
| POST | `/auth/register` | exempt | Supabase-backed register; token may be null pending confirmation |
| POST | `/auth/login` | exempt | Supabase-backed login; returns identity token material per approved auth policy |
| POST | `/auth/refresh` | exempt | Refresh/rotation; exact cookie/body strategy decided before P1 |
| POST | `/sessions` | exempt, bearer required | Register installation/open app session |
| POST | `/sessions/{id}/refresh` | current session | Rotate opaque app-session token |
| DELETE | `/sessions/current` | current session | Logout/revoke current session |
| GET | `/account/me` | required | Principal/profile/status/features/current session/device |
| GET | `/account/sessions` | required | Owner-only list; no raw token/IP detail exposed |
| DELETE | `/account/sessions/{id}` | required | Revoke owner session |
| GET | `/account/devices` | required | Owner installation list/current/status/last_seen |
| PATCH | `/account/devices/{id}` | required | Rename/revoke owner installation |

Session creation request:

```json
{"installation_id":"browser-generated-uuid","label":"Chrome on Mac","client":{"app_version":"web-0.1","user_agent_family":"Chrome"}}
```

Response returns `session.id`, one-time `session_token`, `expires_at`, device summary and feature grants. Never return token hash. Limits/expiry are server configuration exposed only as safe capability values.

`GET /account/me` target:

```json
{
  "user":{"id":"usr_opaque","email":"u@example.com","display_name":"User","role":"user","status":"active"},
  "features":["screener","backtest"],
  "grant":{"valid_until":"2026-10-16T00:00:00Z"},
  "session":{"id":"ses_opaque","expires_at":"2026-09-17T00:00:00Z"},
  "device":{"id":"dev_opaque","label":"Chrome on Mac","current":true},
  "capabilities_version":"cap-1"
}
```

## 3. Capabilities, rules, datasets and compute access

| Method | Route | Feature | Purpose |
| --- | --- | --- | --- |
| GET | `/capabilities` | authenticated | Supported schema versions, markets, timeframes, operands/operators, limits, engine version |
| GET/POST | `/rules` | screener | List/create system-visible + owner rules |
| GET/PATCH/DELETE | `/rules/{id}` | screener | Owner/system policies + optimistic concurrency |
| POST | `/datasets/prepare` | screener/backtest by purpose | Validate scope; fetch/normalize/cache server-side; returns metadata/handle |
| GET | `/datasets/{id}/manifest` | matching feature | Version/hash/quality/warmup/range/size, no candle body |
| GET | `/datasets/{id}/content` | matching feature | Canonical compressed payload; bounded/range-checked; no server compute |
| POST | `/compute-grants` | purpose feature | Short-lived coordination receipt for a run; not DRM or proof result correctness |

Rule snapshot minimum:

```json
{"id":"rule_opaque","name":"Baseline RSI","owner_type":"user","schema_version":"rule-1","engine_version":"core-1","definition":{},"definition_hash":"sha256:...","version":3,"updated_at":"..."}
```

`definition` is intentionally not invented in this document. It is frozen at M0 from selected baseline and represented by JSON Schema in `/capabilities`; FE and Go core consume the same fixtures.

Prepare request:

```json
{"purpose":"backtest","market":"IDX","symbols":["BBCA.JK"],"timeframe":"1d","date_from":"2023-01-01","date_to":"2025-12-31","rule_id":"rule_opaque"}
```

Manifest minimum:

```json
{
  "dataset_id":"ds_opaque","version":"ds-v1","schema_version":"ohlcv-1","provider":"fixture",
  "market":"IDX","currency":"IDR","symbols":["BBCA.JK"],"timeframe":"1d","timezone":"UTC",
  "requested_range":{"from":"2023-01-01","to":"2025-12-31"},
  "available_range":{"from":"2022-10-01","to":"2025-12-31"},
  "warmup_candles":100,"adjustment":"documented-enum","candle_count":800,
  "compressed_bytes":0,"decoded_bytes":0,"checksum":"sha256:...","quality":{"status":"complete","warnings":[]}
}
```

Date bound inclusivity and exact binary/canonical content schema are M0 decisions and recorded in schema fixtures. Content includes no provider credential. Client verifies checksum before decrypt/cache/run.

Compute grant request binds `purpose`, `dataset_id/version/checksum`, `rule_id/definition_hash`, `engine_version`, `schema_version`, session and expiry. Receipt is metadata for evaluation/audit; WASM can be modified and receipt cannot prove what client computed.

## 4. Journal and portfolio routes (P1)

| Method | Route | Purpose |
| --- | --- |
| GET/POST | `/journal/transactions` | Owner list/create; POST idempotency key required |
| GET/PATCH/DELETE | `/journal/transactions/{id}` | Owner-only; version conflict protection |
| GET | `/portfolio/positions` | Authoritative positions and realized P&L |
| GET | `/portfolio/summary` | Bounded totals, valuation source/time/warnings |

Transaction write:

```json
{
  "symbol":"BBCA.JK","market":"IDX","currency":"IDR","side":"BUY",
  "quantity":"100","price":"9000","fee":"2500","executed_at":"2026-09-16T02:00:00Z",
  "note":"Manual fill","source":"manual","source_reference":null
}
```

`source=analysis_draft` may include non-authoritative reference/result metadata, but server still treats confirmed values as user-entered journal data. Server ignores client P&L/cost values. Response includes id/version/timestamps and recalculation state. Long-only P1 rejects SELL exceeding holdings after chronological recomputation.

Position:

```json
{
  "symbol":"BBCA.JK","quantity":"100","average_cost":"9025","realized_pnl":"0",
  "last_price":"9100","last_price_at":"...","valuation_status":"historical","unrealized_pnl":"7500",
  "cost_method":"weighted_average","version":4
}
```

Missing quote uses null price/P&L and warning, not zero.

## 5. Restricted operator contract (P1)

CLI/local operator tooling is sufficient for P0 seed. Local grant/revoke now
requires actor, reason, and expiry where applicable; actor/request ID/before/after
are stored atomically in an append-only audit table. P1 may expose protected
`/operator/grants` list/create/revoke only after role guard, bootstrap, and
last-operator safety are implemented. Operator cannot read private rule/journal
bodies solely by role.

Payment status is not part of manual grant. Full admin user management, billing webhooks, release management and metrics dashboard are P2 per revised priorities.

## 6. Worker protocol (P0)

Dedicated ES module Worker owns Go runtime/WASM. Message schema versioned and validated both sides.

Main → worker:

```ts
type WorkerRequest =
  | { type: "init"; protocol: "worker-1"; wasmUrl: string; wasmSha256: string }
  | { type: "run"; protocol: "worker-1"; jobId: string; purpose: "screen" | "backtest";
      engineVersion: string; dataset: ArrayBuffer; datasetManifest: object;
      ruleSnapshot: object; config: object }
  | { type: "cancel"; protocol: "worker-1"; jobId: string }
```

Worker → main:

```ts
type WorkerEvent =
  | { type: "ready"; protocol: "worker-1"; engineVersion: string; capabilitiesVersion: string }
  | { type: "progress"; jobId: string; stage: "decode"|"validate"|"indicators"|"evaluate"|"metrics"; completed?: number; total?: number }
  | { type: "result"; jobId: string; execution: "client_wasm"; result: object; warnings: object[]; timings: object }
  | { type: "cancelled"; jobId: string }
  | { type: "error"; jobId?: string; code: string; message: string; retryable: boolean; details?: object }
```

The dataset buffer is transferred, not cloned. Only one job per worker. FE throttles progress rendering; worker emits meaningful counts/stages, not fake percentages. Cancel may be implemented by terminating/recreating worker if cooperative cancel cannot interrupt Go/WASM reliably; terminal cancelled state must be deterministic. Late events for old jobId ignored.

Result minimum: protocol/engine/schema/data/rule/config hashes, purpose, execution, signals/matches or trades, supported metrics, assumptions, warnings and stage timings. Exact trade/config/result schema is frozen M0 from baseline; do not invent metrics the selected engine cannot produce.

## 7. Limits, versions and compatibility

Initial guard: up to 5 symbols demo, 100.000 aggregate candles and 50 MiB decoded/job, subject to M0 profiling. API checks declared plus actual decompressed size (zip-bomb protection). Server max range/response/request/timeouts explicit in capabilities.

Breaking changes increment route/schema/protocol versions. Engine artifact has semantic/build version and SHA-256; runtime glue must match build. Rule/data/result record their schema version. Client rejects unsupported major versions and invalidates incompatible cache, never guesses conversion.

## 8. Contract test checklist

- Generated/examples parse against OpenAPI/JSON schema; FE types and Go DTO fixtures match.
- 401/403/404/409/413/429/503 mappings and stable codes.
- Bootstrap session exception does not permit business route bypass.
- A/B ownership on every private route and nested ID; revoked/expired session/grant.
- Dataset actual decompressed limit, checksum, quality warnings and wrong-purpose access.
- Rule hash/engine/schema mismatch denied before compute.
- Worker init/run/progress/result/error/cancel/stale-job, unsupported browser and invalid payload.
- Journal idempotency/version conflict/oversell/backdated recompute/missing quote.

This document intentionally does not lock provider, payment, rule formula, trade fill policy, cache engine, expiry values or production URLs before their stated decision gates.
