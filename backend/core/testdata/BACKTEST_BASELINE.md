# Backtest fixtures

`claudio_backtest_formula_v1.json` freezes only the unchanged per-share price
return and all-in fractional-capital formula for one 100 -> 110 long, no costs.
`python3 scripts/check_claudio_backtest.py` executes the exact two nested legacy
functions, without importing FastAPI or fetching market data. A source SHA-256
requires intentional review if the legacy reference changes.

`backtest_next_open_v1.json` is a synthetic daily UTC session fixture (calendar
weekends deliberately retained, no claim of an exchange calendar). The signal
candle closes at 100; the following session opens at 110. This catches using a
known signal-candle price as an executable fill. Other entries exercise overlap,
insufficient remaining candles, and an open final position. The `.expected.json`
file freezes the independent horizon summaries; tests additionally assert fill
prices, costs, quantity, cash, drawdown, entry/exit times and nullable ratios.

T+1 final equity = 10000 * (115/110) * (100/120) * (125/120).
T+2/T+3 final equity = 10000 * (100/110) * (125/120); final leg remains open.
Max drawdown for T+2 = (115 - 100) / 115 * 100 percent, measured from marked equity.

Use absolute tolerance 1e-8 + relative 1e-12 for golden summaries; native/WASM
comparison uses absolute 1e-9 + relative 1e-12 for every numeric result field.
There is no full parity claim with the legacy overlapping-capital simulation or
its shortened final holding period. Current policy intentionally differs.
