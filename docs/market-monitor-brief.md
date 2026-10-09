# Market Monitor extension

## Direction contract

THESIS: Inspect one IDX stock without turning the workspace into an order-entry terminal. No fabricated live quotes or trading recommendations.

OWN-WORLD: Inherit Signalgen's Manrope typography, semantic light/dark surfaces, green selection, 14px corners and existing workspace gutters.

STORY: Choose or add a ticker, inspect its daily TradingView chart, then review indicators from a completed screener run. Empty evidence leads to Screener.

FIRST VIEWPORT: Quiet horizontal symbol strip, full-width daily chart above an editable watchlist table with real screening snapshot columns. The chart has a user-requested macOS-style title bar with decorative traffic lights, selected ticker, daily interval and external TradingView action; the table retains ordinary workspace styling. Session screening history follows below. Mobile preserves that order with contained horizontal table scrolling.

FORM: User-approved monitor composition from the preceding proposal; local extension, no concept seed needed. Code-led interface, no raster assets.

PRICE COLOR: Open prices use a theme-aware blue. Closing prices compare with the same candle's open: green/up arrow for higher, red/down arrow for lower, neutral/minus for unchanged. Missing or non-finite values stay muted and never imply a direction. These are candle snapshots, not portfolio profit/loss.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
