# M0 baseline: Default Scalping signal parity

Status: frozen first signal-generation subset. This is not yet the final trade
or P&L backtest baseline.

## Selected existing behavior

- Existing rule: `Default Scalping` from `backend/app/storage/init_db.py`.
- Existing Python formula source: `ta.trend.ema_indicator`,
  `ta.momentum.rsi`, and `app.core.rule_engine.RuleEngine`.
- Operands: `EMA9`, `EMA20`, `PRICE`, and `RSI14`.
- Logic: all conditions use `AND`.
- Evaluation: each input row is already a completed candle and is evaluated at
  its close after indicator warmup.
- Output: BUY signal timestamps, close prices, and indicator values.
- Numeric tolerance: absolute error `1e-9` for this synthetic fixture.

## Dataset

`default_scalping_v1.json` contains 40 synthetic daily OHLCV candles labelled
as an IDX/IDR fixture for `BBCA.JK`. It is deterministic test data, not copied
market data and not a claim about a real BBCA price series.

Canonical candle hash procedure:

1. Serialize only `request.candles` as UTF-8 JSON.
2. Sort object keys.
3. Use `,` and `:` separators with no extra whitespace.
4. Calculate SHA-256.

Frozen SHA-256:

```text
db2cd30ef88ed5ed1af7fea79bb601c247b9854f3515de1532599161b2e54fcc
```

The committed expected values were printed by:

```bash
PYTHONPATH=backend python backend/scripts/export_m0_baseline.py
```

Run that command only to inspect a candidate library change. Golden values must
not be overwritten automatically; differences require review and a new fixture
version.

## Explicitly unresolved

Trade entry timing, exits, position sizing, commission, slippage, open positions,
and P&L are not inferred from the signal-only legacy engine. They remain the
next M0 decision before the feature may be described as full backtest parity.
