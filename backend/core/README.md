# SignalGen portable Go core

This directory starts the post-assistance migration without replacing the
legacy FastAPI backend. The first frozen subset mirrors the existing **Default
Scalping** rule using `EMA9`, `EMA20`, `PRICE`, and `RSI14` on completed candles.

Current scope:

- deterministic indicator and AND-rule evaluation;
- separated `ComputeFeatures` (client-heavy stage) and `EvaluateDecision`
  (proposed server-private stage), composed by legacy-compatible `RunSignals`;
- a committed synthetic IDX-labelled OHLCV fixture;
- golden signal parity against the Python `ta` and `RuleEngine` baseline;
- strict rejection of unsupported operands and malformed candle ordering;
- a minimal `js/wasm` adapter.
- versioned capabilities exposed as `signalgenCapabilities()`.

It intentionally does **not** define trade fills, exits, P&L, provider data,
HTTP, persistence, authentication, or entitlement yet. Those policies must be
frozen separately before they are implemented.

The split is currently an experiment inside one Go package. The existing WASM
adapter still exposes `RunSignals`, so this refactor alone does **not** hide the
decision rule from the WASM artifact. Protection begins only after the WASM
entrypoint uses `ComputeFeatures` exclusively and the server exposes the tested
decision stage through the reviewed private-scoring contract.

The only accepted purpose is currently `screen`. A request with
`purpose: "backtest"` fails explicitly until the trade-entry, exit, sizing,
fee, and slippage policies have a reviewed M0 fixture.

Run the Go tests through Docker from the repository root:

```bash
docker build -f backend/Go.Dockerfile --target test .
```

Build the browser artifact:

```bash
docker build -f backend/Go.Dockerfile --target wasm-artifact \
  --output type=local,dest=frontend/web/public/wasm .
```

The output contains `signalgen_core.wasm`, `wasm_exec.js`, and
`signalgen_core.manifest.json`. The manifest records the exact engine, schema,
capabilities, worker protocol, byte sizes, and SHA-256 values expected by the frontend.
The WASM and runtime files must always come from the same Go toolchain build.
Generated artifacts are build outputs and are not committed.

After building, perform the lightweight boundary check:

```bash
backend/scripts/verify_wasm_boundary.sh frontend/web/public/wasm/signalgen_core.wasm
```

This verifies the feature export is present and known decision markers are absent.
It is a regression guard, not proof that a WASM binary cannot be reverse engineered.
