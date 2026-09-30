# Frontend Handoff — Hybrid Screener Model A

Status: backend contract implemented on `feature/hybrid-screener-design`; frontend
integration is still required after both branches share a common base.

## Important mismatch to resolve

The current `frontend-website` POC expects one object containing `rsi`,
`ema_fast`, `ema_slow`, `volume_ratio`, and `atr_ratio`. The verified backend
baseline produces a candidate series containing `price`, `ema9`, `ema20`, and
`rsi14`. Do not silently map or invent ATR/volume formulas.

For the first integrated vertical slice, use the verified backend contract below.
ATR and volume ratio need a separate reviewed fixture and version bump.

## WASM worker

- Require manifest `engine_version=core-0.3.0`.
- Require `worker_protocol=worker-2`.
- Require `feature_schema_version=screener-features-1`.
- Call global `signalgenComputeFeatures(requestJSON)`.
- Do not call or expect `signalgenRunSignals`.
- Request shape:

```json
{"purpose":"screen","symbol":"BBCA.JK","candles":[]}
```

The successful envelope contains `result.candidates`. Transfer/parse the dataset
inside the worker and never place the full candle array in long-lived React state.

## HTTP sequence

1. Create/verify app session.
2. Prepare/download the authorized dataset.
3. Obtain system rule metadata. Its private `definition` is intentionally absent;
   use only `id`, `definition_hash`, and versions for the compute grant.
4. Create the compute grant.
5. Call `POST /api/v1/screener/socket-tickets`:

```json
{"compute_grant_id":"cgr_...","protocol":"screener-private-1"}
```

6. Build the WebSocket URL from API origin + `websocket_path` + encoded ticket.
   Never print or persist the ticket.

## WebSocket request

Send exactly one JSON text message after opening:

```json
{
  "type":"screener.evaluate",
  "protocol":"screener-private-1",
  "request_id":"browser-generated-uuid",
  "engine_version":"core-0.3.0",
  "feature_schema_version":"screener-features-1",
  "candidates":[]
}
```

The full candidate/result schemas and stable socket errors are in
`hybrid-screener.schema.json`. A ticket is consumed on the first connection; retry
the whole ticket request rather than reconnecting with the same ticket.

## Required frontend tests

- manifest rejects old engine/worker/feature schema;
- worker sends no rule definition to WASM;
- system rule response without `definition` is accepted;
- socket sends one candidate batch and maps result by symbol + timestamp;
- expired/replayed ticket obtains a new ticket once;
- session revoked/entitlement denied returns to the correct access UI;
- cancellation terminates worker/socket and ignores late messages;
- ticket/token never appears in console, analytics, or persisted storage.
