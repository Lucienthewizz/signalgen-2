# Backtesting result explorer

Both **Analyse every signal** and **Portfolio simulation** include:

- Best/worst stock and mean return, with the population named in each label.
  Study statistics cover evaluated independent signals; portfolio statistics
  cover closed accepted trades in the selected horizon.
- Section navigation that moves keyboard focus and opens collapsed sections.
  Reduced-motion preferences suppress smooth scrolling.
- A paginated return heatmap. Green is positive, red is negative, and neutral
  means zero or unevaluated. Each tile shows the stock, signal date and return;
  the colors do not carry information on their own.
- A details dialog opened from a tile or table row. Portfolio details include
  recorded prices, commissions, status and P&L. Study details show the reference
  close and evaluated outcome, without inventing trades or fees. Timestamps use
  SGT; date-only trading sessions are not shifted.
- **Export PDF**, which opens a printable report in a new tab. Choose
  **Print / Save as PDF** there. The report includes configuration, coverage,
  insight metrics, a chart and all records in the selected scope, regardless of
  table pagination. Portfolio reports use the selected horizon's equity curve;
  study charts show mean return by signal date, not cumulative portfolio P&L.
- Complete, partial, processing and stopped coverage. Study failures, remaining
  stocks and missing future candles remain visible. A completed simulation is
  scoped to its selected source; it does not imply complete market coverage.

The study heatmap initially follows the current signal-detail page. **Load all
saved signals** reads the rest from this browser's temporary IndexedDB store.
Export reads all local records and checks their count against the study summary.
Missing records or an account/result change stops export. No new provider call,
backend calculation, cloud upload or account transaction is added.

## Verification

With the development website running on port 5174:

```sh
npm run test:result-explorer
npm test
npm run build
npm run check:budgets
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if Chromium is installed outside the
default Playwright location. Set `SIGNALGEN_TEST_BASE_URL` for another local
origin and `SIGNALGEN_TEST_OUTPUT` for test screenshots/PDFs (default:
`/tmp/signalgen-result-explorer`).

The browser test reuses the existing synthetic account/API fixtures, with real
React, Go/WASM and IndexedDB. It checks widths 390, 1218 and 1456; heatmap
pagination; positive/negative values; details and Escape/focus return; section
navigation; full-report record counts; PDF generation; empty results; missing
local records; missing future candles; partial failures; and stopped runs.
These fixtures do not measure all-market backend throughput or provider latency.
