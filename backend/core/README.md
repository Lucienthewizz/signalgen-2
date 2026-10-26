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

Backtesting adds an independent `backtest-1` / `holding-next-open-1` contract:
`ComputeBacktestFeatures` computes indicators and `RunBacktest` accepts entry
references, applies next-open fills, long-only holding horizons, cash-aware sizing,
fees/slippage, independent portfolios, marked equity and open final positions.
Private rule decisions remain server-only. The WASM exports are
`signalgenComputeFeatures`, `signalgenComputeBacktestFeatures`,
`signalgenRunBacktest`, and the two capability functions. The WASM boundary check
rejects known private-decision markers. The screening purpose/version contract
remains unchanged; use the dedicated backtest entrypoints.

See [backtest contract](../../docs/backend/BACKTESTING.md) and
[frozen fixtures](testdata/BACKTEST_BASELINE.md). This is hypothetical analysis,
not authoritative journal accounting or broker execution.

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
