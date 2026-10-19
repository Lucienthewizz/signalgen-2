# Frontend screening workflow

This extension follows the approved preset-first workflow: choose a starting rule, edit its criteria, save it, select a market-specific stock universe, and run screening. Stockbit informs the task order; Signalgen retains its existing green ledger, Saira workspace typography, English interface, and shared shadcn/Base UI controls.

## Behavior

- Six editable presets use the supported close price, EMA 9, EMA 20, and RSI 14 inputs: bullish EMA cross, bearish EMA cross, RSI below 30, RSI above 70, price breakout, and trend confirmation. Selecting a preset fills the form; saving and running remain explicit actions.
- Rules expose BUY/SELL direction, ALL/ANY conditions, cooldown, readable summaries, and field validation. Validation covers the name, 1–20 conditions, supported operands, finite numeric thresholds, and cooldown from 0 to 86,400 whole seconds.
- Universe creation filters the catalog by IDX/IDR or US/USD. Changing market clears the selected stocks after confirmation. Each universe uses one market and currency; numeric price/EMA criteria use that currency without conversion.
- Before running, screening shows the saved rule, universe, and readable criteria. Results provide search, sorting, BUY/SELL, matched, cooldown, and not-matched filters. CSV exports the currently filtered rows with market, currency, candle time, rule version, and reason codes.
- Details show snapshot values and condition evidence. Crossovers require previous and current candle values; missing previous values are labeled unavailable. Saved history preserves signal direction and previous features when present. Older snapshots without that evidence are not reinterpreted using today's rule.
- History supports search and market filtering. The overview summarizes the latest locally saved screen. Quota copy describes remaining capacity while the server remains the authority; cache copy distinguishes unavailable storage from empty storage and reports clear failures.

## Scope and incumbent system

The extension uses compact labeled rows, ledger dividers, existing panel gutters, wrapping filters, and stacked mobile controls. It introduces no new visual identity. Existing profile/session, chart, comparison, draft recovery, and screening recovery flows are reused; these are not all new features of this change. Backend contracts and database schemas are outside this frontend extension.

The existing `docs/DESIGN.md` still describes Manrope across workspace surfaces, while `frontend/web/src/styles/workspace-typography.css` already establishes Saira for the workspace. `docs/PRODUCT.md` also describes an IDX-focused workspace, while the incumbent frontend supports US/USD alongside IDX/IDR. These are pre-existing documentation differences. This feature preserves the approved Saira and market-aware implementation without rewriting the design specification or its sidecar.

## Verification and limits

The integration verification reported a passing production build, 134 unit tests, and isolated Playwright CLI fixtures across ten routes at desktop/mobile sizes in light/dark themes. Additional save-flow and screenshot checks belong to the final delivery report. These fixture checks do not verify live backend authorization, provider availability, or live market data. Screening output remains a daily snapshot; the embedded provider chart can update independently.

Documentation was checked against the current rule composer, screener, universe picker, result persistence, condition evidence, overview, quota/cache components, and workflow stylesheet. The available code graph generation was stale, so current source reads were used for this comparison. Preserve `docs/DESIGN.md`, `.impeccable/design.json`, and unrelated working-tree changes unless a separate documentation refresh is requested.
