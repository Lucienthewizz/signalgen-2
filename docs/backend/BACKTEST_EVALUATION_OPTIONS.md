# Backtest evaluation options

The **Analyse every signal** panel now lets the user choose an evaluation method,
then compare the existing Go/WASM results without rerunning the study. It follows
the existing `signal-study-1` / `signal-close-independent-1` contract; no engine,
execution, entitlement, scheduler, collection, or retention policy changes.

## Workflow

1. Choose a screening rule and stock source, or follow the existing historical
   screen → evaluation handoff with its rule, source and dates.
2. Set the signal search dates. These dates select when signals occurred. For
   example, a January search can evaluate every matching signal through T+3.
3. Set 1–100 trading candles after each signal, separately from the search dates.
   This is the maximum exact horizon and the barrier observation window.
4. Choose one of the methods below and start the study. Target fields become
   required only for the selected barrier method; changing method clears them.
5. Compare exact Open/Close at any returned T+X with the frozen window result.
   Review individual stock, signal date, reference Close, observed price/date,
   return, barrier status and first hit candle. Results remain paginated.

| Method | Existing output used | Interpretation |
| --- | --- | --- |
| Exact T+X Open / Close | `horizons` and each event's `outcomes` | Price on that exact trading candle relative to signal Close; a negative return stays negative. High remains available in the full horizon/detail tables as historical potential. |
| Target reached within window | TP-only `swing` | First favorable target touch at T+1…T+n, including its candle timestamp and threshold price; no SL is applied. |
| TP / SL within window | TP+SL `swing` | First barrier touch; if both touch on one daily candle, SL wins, as in the existing core. |

For both barrier modes, an unhit **complete** window uses its final Close. An
unfinished window is incomplete unless a barrier already resolved it. Thus a
positive unhit window can contribute a win. The displayed win rate is positive
outcomes / evaluated signals, **not target-hit rate**. Separate aggregate hit
counts/rates are not exposed by the current study contract.

BUY and SELL returns retain the core's directional convention. SELL analysis is
an independent directional observation, not a simulated short position. Daily
OHLC establishes a hit candle, not intraday hit order, execution time or a broker
fill. The reference Close becomes known only after the signal candle closes.

## Comparisons and denominators

The comparison table shows signals, evaluated, incomplete, win/loss/flat counts,
win rate and average return together. Exact Open, exact Close and barrier rows
share the same signal reference; choosing a different exact T+X never changes the
frozen barrier window. Average return includes losses and flats. Incomplete
outcomes are excluded from evaluated denominators rather than counted as losses.
Provider/history failures remain in separate stock coverage counts; they are not
successful stock evaluations or signals with invented zero returns.

The panel labels these as **signal-study statistics**. Signals may overlap and
are never summed into portfolio profit. Fees, slippage, capital allocation and
broker execution are absent from this mode. The existing **Portfolio simulation**
mode remains separate.

## Compatibility

- API and worker inputs, Go/WASM calculations and limits are unchanged.
- The existing authenticated backtest access check and owner-scoped temporary
  storage remain in their existing paths. This change adds no bypass.
- The screen/backtest handoff is preserved. Historical screening alone still
  does not evaluate subsequent outcomes.
- Events CSV still exports every exact horizon and the window result, regardless
  of the current comparison selection; all-horizons and coverage exports retain
  their existing format. CSV does not gain a hit-timestamp column in this slice.
- Reload, cancellation, partial coverage, failed-stock retry and frozen-context
  messaging remain. Changing evaluation method also invalidates a frozen retry.

## Verification

See [the evidence record](../evidence/backtest-evaluation-options.md) for actual
checks, synthetic fixture values, browser artifacts and tooling limitations.
Run the new suite from `frontend/web` with a local dev server on unused port 5182:

```sh
npm ci --ignore-scripts
npm run dev -- --port 5182 --strictPort
node tests/browser/evaluation-options.mjs
```

Generate the ignored WASM artifact from matching Go source as described in the
frontend README before browser checks. The suite prefers an available
`playwright-cli`, configurable through `SIGNALGEN_TEST_PLAYWRIGHT_CLI`, and falls
back to the project's existing Playwright package. `SIGNALGEN_TEST_BASE_URL` and
`SIGNALGEN_TEST_BROWSER_EXECUTABLE` can override local defaults. It blocks external
origins and supplies synthetic account, rule, catalog, historical data and private
signal responses; the app, worker, Go/WASM and IndexedDB are real.
