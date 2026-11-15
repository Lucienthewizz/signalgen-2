# Pen workspace redesign

The user authorized a new visual identity for eight workspace routes, using the supplied `untitled.pen` frames. Landing and authentication retain their current identity. The reference was read through Pen MCP and exported locally to `/tmp/signalgen-pen-reference/`; these temporary exports are review evidence, not application dependencies.

## Scope and composition

| Route | Composition |
| --- | --- |
| `/#app/overview` | Analysis continuation and portfolio P&L, summary resources, recent activity |
| `/#app/analysis` | Existing screener filters, run stages, result evidence, and journal selection |
| `/#app/backtest` | Study form beside a guide; results occupy the full width |
| `/#app/journal` | Saved screening table before the existing journal portfolio |
| `/#app/rules` | Composer on the left; height-matched paginated saved library on the right; existing editing dialogs |
| `/#app/universes` | Category dropdown and catalog on the left; selected stocks on the right; existing universe editing |
| `/#app/realtime` | Chart and details first; heatmap, comparison table and snapshot history below |
| `/#app/news` | Shared filter toolbar above articles and the existing player; compact carousel choices |

The existing ReactBits components and animation behavior remain within the adapted composition. Account, API, screening, and financial logic are outside the visual replacement scope.

## Design authority

`frontend/web/src/styles/pen-workspace.css` defines the scoped charcoal/mint palette, flat surfaces, responsive layout overrides, and local fonts. Headings, navigation, and buttons use Rajdhani 600, following the user's final typography choice. Numbers and tables use IBM Plex Mono 400/600; prose uses Inter Variable. `docs/DESIGN.md` records durable workspace tokens with a `workspace-` prefix while preserving the public design reference.

The workspace sidecar is `frontend/web/.impeccable/design.json`. It extends those prefixed tokens with component previews and breakpoint metadata. The root `.impeccable/design.json` and `.impeccable/config.json` had pre-existing unrelated state; they remain outside this change. Tools that only discover a root sidecar must be pointed to the workspace sidecar explicitly.

The supplied reference is dark. Light mode uses an implementation adaptation for theme compatibility; the product currently keeps its theme switch hidden. No source frame establishes a separate light design.

## Verification evidence

The production build, 264 unit tests, and performance budgets passed. The full browser regression passed across 10 workspace routes at two viewport sizes, public/account routes, history/evidence/CSV, monitor sorting, sidebar navigation and expired-session cleanup. Scoped usability, backtest, signal-study, journal-explorer and portfolio browser tests also passed. These tests use synthetic account/API fixtures; the backtest and study suites exercise the real Go/WASM engine.

A separate browser pass produced 48 screenshots across the eight Pen routes at 1440px, 1218px, and 390px, in dark and light themes, under `/tmp/signalgen-pen-qa/`. It checked workspace font application, the dark canvas token and page overflow. A fresh reviewer using the fallback finish-reviewer guidance inspected the references and captures; the clipped News player label was corrected and the final scoped verdict was `ship`.

The screenshot-and-annotation refinement adds a dedicated `node scripts/test-workspace-layout.mjs` check: 25-rule paging/search/filter/edit, editor/library height, rounded Dashboard cards, equal shortcut widths, full-width keyboard slider, a 32-stock catalog with pagination/empty results, News columns and chart-first monitor order. That check passed at 1218px and 390px with synthetic account/API data.

`test:catalog` now checks its isolated fixture's intended theme switch rather than treating it as the dark-only product UI. Its category/search/selection-limit/paging/keyboard/empty/loading checks passed at 1440px, 900px and 390px in both themes. This changes the test assertion, not the product theme policy. The study suite and portfolio transaction/chart/carousel suite also passed after the refinement. The final full browser regression also passed after these refinements. No verification here establishes live backend, payment, market-data or real-account behavior.

## Screenshot and annotation refinements

The newer layout screenshots guide composition while preserving existing components, animations and font roles. The explicit annotation places saved rules on the right, overriding the reference image's left-hand library.

- Dashboard resource cards have rounded corners and consistent icon/copy insets. Quick-access titles are larger and the redundant “Follow the market” label is removed.
- Workspace primary actions use dark green `#064c35` with pale foreground text. Mint remains available for readable status and link accents.
- Saved rules follow the composer height, paginate according to available space, and reset pagination when search or signal filters change.
- The study guide uses three structured steps. The horizon input, slider and help span their form row. Portfolio simulation keeps its run stages inside Configuration. Shared sliders retain keyboard operation without the oval surface.
- Universe categories use a dropdown. The catalog and selection remain separate panels, with space below catalog content.
- News uses a shared toolbar above its article/player columns. Market Monitor puts the chart and details before the existing heatmap and ledger.
- Journal, Screener and Market Monitor tables wrap within their cards. Below a 760px container width, they become labelled records without dropping fields or requiring horizontal scrolling.
- The sidebar brand link accommodates its mark and full wordmark while preserving the collapsed state.

The dedicated layout check also covers plain sliders, the contained portfolio stepper, brand clipping through ancestor bounds, dropdown categories, and fitted/stacked data tables. It uses synthetic fixtures at 1218px and 390px. Build, unit and performance-budget checks passed after the final CSS corrections.

## Backup and delivery boundary

The backup branch `frontend/pre-pen-redesign-20261115` points to `9417a5a` and was verified on the remote before redesign work. The implementation branch is `frontend/pen-workspace-redesign`. The backup records the committed baseline; unrelated pre-existing local changes must be preserved separately during any rollback. Do not reset the shared working tree to restore visual styles.
