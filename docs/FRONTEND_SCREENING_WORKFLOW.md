# Frontend screening workflow

This extension follows the approved preset-first workflow: choose a starting rule, edit its criteria, save it, select a market-specific stock universe, and run screening. Stockbit informs the task order; Signalgen retains its existing green ledger, Saira workspace typography, English interface, and shared shadcn/Base UI controls.

## Behavior

- Six editable presets use the supported close price, EMA 9, EMA 20, and RSI 14 inputs: bullish EMA cross, bearish EMA cross, RSI below 30, RSI above 70, price breakout, and trend confirmation. Selecting a preset fills the form; saving and running remain explicit actions.
- Rules expose BUY/SELL direction, ALL/ANY conditions, cooldown, readable summaries, and field validation. Validation covers the name, 1–20 conditions, supported operands, finite numeric thresholds, and cooldown from 0 to 86,400 whole seconds.
- Universe creation filters the catalog by IDX/IDR or US/USD. Changing market clears the selected stocks after confirmation. Each universe uses one market and currency; numeric price/EMA criteria use that currency without conversion.
- IDX and US category shortcuts have separate ticker mappings. US shortcuts cover selected blue chips, banks, energy, consumer, property, and technology companies; they are curated, not exhaustive sector coverage. Unmapped stocks remain searchable in All stocks. Identical ticker stems across markets do not imply the same company or category.
- Before running, screening shows the saved rule, universe, and readable criteria. Results provide search, sorting, BUY/SELL, matched, cooldown, and not-matched filters. CSV exports the currently filtered rows with market, currency, candle time, rule version, and reason codes.
- Details show snapshot values and condition evidence. Crossovers require previous and current candle values; missing previous values are labeled unavailable. Saved history preserves signal direction and previous features when present. Older snapshots without that evidence are not reinterpreted using today's rule.
- History supports search and market filtering. The overview summarizes the latest locally saved screen. Quota copy describes remaining capacity while the server remains the authority; cache copy distinguishes unavailable storage from empty storage and reports clear failures.

## Scope and incumbent system

The extension uses compact labeled rows, ledger dividers, existing panel gutters, wrapping filters, and stacked mobile controls. It introduces no new visual identity. Existing profile/session, chart, comparison, draft recovery, and screening recovery flows are reused; these are not all new features of this change. Backend contracts and database schemas are outside this frontend extension.

Condition editing uses aligned indicator/comparison/reference columns on desktop and visible field labels on stacked mobile rows. Add condition is a compact action rather than a full-width bar; remove actions retain a usable touch target. These layout refinements do not change rule evaluation or silently remove duplicate conditions.

Presets fill the available width as green selection cards. Desktop criteria use centered column headings and a separate No column; mobile retains visible field labels. Screener previews show selected stocks as small wrapping cards, a compact condition summary, and consistently inset search/status filters.

Selected-stock cards stretch to both edges of each wrapped row. The Screener condition preview uses separate rounded cards rather than divider-only rows, with two columns on desktop and one on mobile; condition order and matching logic remain unchanged.

Stock Universe keeps the category table first and full-width. Separate Search stocks and Selected stocks cards follow side by side on wide screens, stacking at 1,100px and below. Your stock universes follows both. The browse card and selected ticker items use existing green surface roles; category, search, selection, and save behavior remain unchanged.

Login and registration use an inset, rounded card with a compact header and shared form/heading alignment. The auth layout collapses before its desktop minimum columns overflow. A failed backend health probe no longer replaces the Rules editor: the current draft and input DOM remain available, with server save/delete disabled until reconnection. This prevents connection-related form disappearance; it does not disable development-server hot reload when source files change.

The existing `docs/DESIGN.md` still describes Manrope across workspace surfaces, while `frontend/web/src/styles/workspace-typography.css` already establishes Saira for the workspace. `docs/PRODUCT.md` also describes an IDX-focused workspace, while the incumbent frontend supports US/USD alongside IDX/IDR. These are pre-existing documentation differences. This feature preserves the approved Saira and market-aware implementation without rewriting the design specification or its sidecar.

## Verification and limits

The results panel exposes provider quality warnings through an inline Data quality disclosure above the table. A validated/complete payload is not described as gap-free market history. Daily candle dates use Asia/Jakarta for IDX or America/New_York for US, while dataset timestamps remain UTC. Mixed candle dates are shown as a range. History retains status counts for BUY, SELL, matched-without-direction, cooldown, and not matched; opening a snapshot never reruns the rule.

Crossover evidence compares the actual previous and current values in two columns; missing evidence stays unavailable. Market Monitor distinguishes the independent TradingView feed from dated screening snapshots. A shared API status indicator uses the existing sequential health probe: reconnecting is shown only during a retry after failure, not while idle or on every successful background check. Draft retention and explicit server save behavior remain unchanged.

Timeout, connection, access, and transient-server recovery reuse the existing error handling. Backend dataset failures do not all have distinct public reason codes, so the frontend does not invent an insufficient-history diagnosis or turn failure into Not matched. Live provider and database availability are not verified by the synthetic tests.

Frontend verification includes a production build, 155 unit tests, and isolated Playwright CLI fixtures across ten routes at desktop/mobile sizes in light/dark themes, plus preset save, three-row alignment, US category filtering, a ten-stock preview, persisted quality notes, market timezone dates, crossover comparison, and API connection recovery. These fixture checks do not verify live backend authorization, provider availability, or live market data. Screening output remains a daily snapshot; the embedded provider chart can update independently.

Documentation was checked against the current rule composer, screener, universe picker, result persistence, condition evidence, overview, quota/cache components, and workflow stylesheet. The available code graph generation was stale, so current source reads were used for this comparison. Preserve `docs/DESIGN.md`, `.impeccable/design.json`, and unrelated working-tree changes unless a separate documentation refresh is requested.
