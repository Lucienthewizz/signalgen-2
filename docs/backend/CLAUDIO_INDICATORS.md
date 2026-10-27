# Claudio rule indicators

27 October 2026. Runtime: `core-0.5.0`, `capabilities-4`,
`claudio-indicators-1`, OpenAPI `0.14.0`.

The web Rules composer, screener and daily backtest support all **78 fixed
operands** in the archived Claudio `RuleEngine.SUPPORTED_OPERANDS`, plus its
dynamic period and previous-value families. The frozen catalog is
`backend/core/indicator_catalog.json`. The archived Python and the supplied
Downloads baseline have identical normalized indicator-engine source.

| Family | Current operands / parameters |
| --- | --- |
| Candle | PRICE, OPEN, HIGH, LOW, CLOSE; PREV_OPEN/PREV_CLOSE and OHLC `_PREV` aliases |
| Simple averages | MA20, MA50, MA100, MA200; MA1–MA250 |
| Exponential averages | EMA6/9/10/13/20/21/34/50; EMA1–EMA250 |
| MACD | MACD, MACD_SIGNAL, MACD_HIST; fast 12, slow 26, signal 9 |
| Oscillators | RSI14, RSI1–RSI250; ADX5, ADX1–ADX250 |
| Bollinger | BB_UPPER, BB_MIDDLE, BB_LOWER, BB_WIDTH; window 20, population standard deviation, multiplier 2 |
| Stochastic | STOCH_K, STOCH_D; window 14, signal mean 3 |
| Ichimoku | ICHIMOKU_CONVERSION/BASE/A/B; 9/26/52, `visual=False` |
| Volume | VOLUME, SMA_VOLUME_20, REL_VOLUME_20; SMA_VOLUME_1–250 and REL_VOLUME_1–250 |
| Distance | PRICE_EMA20_DIFF_PCT = abs(close − EMA20) / EMA20; **not multiplied by 100** |
| Candle flags | Doji, Hammer, Shooting Star, Bullish/Bearish Engulfing, Morning/Evening Star, Harami, Piercing, Dark Cloud Cover |

The static `_PREV` aliases in the catalog and dynamic MA/EMA/RSI/ADX/volume
`_PREV` aliases are supported. Generic `<base>_PREV_<offset>` works with any
supported base, e.g. `EMA37_PREV_3`, `MACD_PREV_5` or
`PATTERN_CDLDOJI_PREV_2`. Period and offset are canonical whole numbers 1–250;
zero-padded names and nested history suffixes are rejected. Offset zero in the
UI chooses the current completed candle.

## Formula and availability parity

Calculations run in pure Go, shared with WASM. EMA uses `adjust=False` and RSI
uses the archived `ta` Wilder implementation. Current MACD appears after 35
candles, Stochastic after 17 and Ichimoku after 52, matching the aggregate
Claudio engine gates. ADX needs at least 2×period candles to initialize the
archived implementation. A generic `_PREV_n` reads the underlying historical
series, just as Claudio's `_calculate_operand_series`; its initial availability
can differ from the aggregate current-value gate. No future candle is read.

Current relative volume is 1 when its average volume is zero, following Claudio.
Generic historical relative volume with a zero denominator stays unavailable.
Undefined Stochastic and incomplete warmup are omitted, never serialized as NaN
or fabricated zero. A missing operand cannot satisfy a comparison or crossover.

The ten candle flags reproduce TA-Lib default predicates and penetration values,
then map the appropriate positive/negative result to 0/1 as Claudio does. Harami
and Doji accept either direction. No additional trend filter is inferred. The
TA-Lib license is included in core licenses, API images and the frontend's
`/licenses/TA-Lib.txt`.

## Data, API and compatibility

Dataset preparation derives `required_operands` and `warmup_candles` from the
authorized server rule, after entitlement and ownership checks. Clients cannot
override that scope in prepare JSON. A changed operand set has a distinct
snapshot reuse key. Screening keeps the prior 100-candle default and requests
up to 830 when a rule requires longer warmup. Intraday expands only within the
existing provider lookback limits; insufficient history returns an explicit
error. Daily backtest retains at most 2,500 candles per symbol and a five-year
entry range, with additional preceding warmup and exit buffers. It can need an
earlier start than the former 90-day buffer.

Pass manifest names into feature computation:

```json
{"purpose":"screen","symbol":"TEST","operands":["MACD","MACD_SIGNAL","EMA37_PREV_3"],"candles":[]}
```

`candles` above is a placeholder: supply at least 20 valid chronological OHLCV
candles and enough for the selected indicators. The legacy `price`, `ema9`,
`ema20`, `rsi14` fields remain required. Additional finite values are in
`features.values`, a map limited to 40 valid names. Baseline fields cannot be
overridden through that map. The additive envelope retains
`screener-features-1`; engine/capability version checks require matching new API
and WASM builds. Refresh/rebuild errors are explicit. Existing valid 0.3/0.4
rules project the current execution version on read without rewriting their
definition, hash, DB version or timestamps. No database migration is needed for
these indicator additions.

Send a symbol's complete candidate sequence together: crossover and cooldown
state must not reset mid-symbol. Screening has a 2 MiB message budget and a
1,000-candidate cap; backtest signals accept 8 MiB / 2,500 candidates. Existing
bearer, app-session, entitlement, ownership, version and timestamp-scope checks
remain in place. Heavy indicator computation stays outside the private scoring
kernel and private rule evaluation stays outside WASM.

## Frontend use

In **Rules**, add a condition, select an indicator group, comparison and reference
indicator or numeric value. Expand **Parameters / previous candle** to edit the
period and historical offset on either side. MACD may use negative or zero
thresholds; a candle flag can use `> 0`. Saved drafts and captured screening
evidence retain the new operands and their values across reloads. All control
labels work with keyboard and screen readers; responsive layout follows the
existing themes.

## Verification

`backend/core/testdata/claudio_indicators_v1.json` freezes the original Python
engine's output on deterministic synthetic OHLCV, including warmup boundaries,
all ten positive candle patterns, flat/zero-volume data, 1/250 periods and
250-candle offsets. Tests compare pure Go with this reference and check prefix
invariance. `backend/scripts/check_backtest_wasm.mjs` compares native and WASM on
identical requests; `verify_wasm_boundary.sh` checks private-kernel exclusions.

To regenerate a *candidate* reference after explicitly reviewing a baseline
change, use the baseline Python environment (pandas, numpy, ta and TA-Lib):
`python backend/scripts/export_claudio_indicators.py`. This deliberately rewrites
the fixture and catalog; never regenerate goldens just to make a failure pass.

The browser tests use synthetic accounts/API data and the actual public WASM
engine. This verifies indicator support, not market-data equivalence between
providers or full Claudio product parity. The backtest execution policy remains
`backtest-2` / `holding-next-open-1`: daily, long only, holding periods. Intraday
backtest, short backtest, TP/SL, exit-rule and other strategy features are separate
work. Rule multipliers are not part of this indicator change.

Final verification on 27 October: full Go test suite passed (database-only
integration fixtures skipped without a disposable database); 192 frontend tests
and production build passed; native/WASM comparisons and private-boundary checks
passed. Playwright verified rule indicator selection/custom periods/history and
screenshots at 1440/390 px in both themes, backtest rule/manual in both themes,
and the existing admin regression. API `/ready` returned 200 and `/api` reported
0.14.0 after a local rebuild. Browser API/account fixtures were synthetic; no
real member grants, journal entries or live provider equivalence were asserted.
Global Prettier still reports five unchanged files: market-news.ts,
foundation-shell.css, news-journal-details.css, workspace-compatibility.css,
workspace-surfaces.css. All changed source files pass the scoped formatter.
