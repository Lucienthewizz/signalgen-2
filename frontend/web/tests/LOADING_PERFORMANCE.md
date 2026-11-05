# Loading efficiency — 5 November 2026

## What changed

1. **Shared UI cache in Market monitor.** Reuses the existing account/revision-scoped,
   memory-only cache. Universe freshness is 30 seconds; catalogue freshness is five
   minutes. Cached presentation data renders first; stale reads refresh in the
   background. Existing mutation invalidation and auth-cache clearing remain in
   force. `Refresh data` explicitly refreshes both resources. No credentials,
   screening authorization or new prices are cached by this change.
2. **Independent resource loading.** Universe completion unlocks the heatmap; the
   catalogue only enriches names. Catalogue failure leaves tickers and existing
   snapshots usable, with an explicit retry message.
3. **Deferred TradingView.** Market monitor creates the widget only after at least
   10% of its host intersects the viewport while the document is visible. No script,
   loading animation or 12-second failure timer is started while deferred. The
   chart's daily interval and initial unzoomed view are preserved. Other consumers
   retain eager loading. Once loaded, TradingView's own activity is external and
   is not paused by this implementation.
4. **Visibility-aware presentation clock.** The monitor's one-minute freshness
   clock has no active interval while the tab is hidden, refreshes once on return,
   and cleans up on unmount. This does not silently stop user-started screening,
   account heartbeats or backend monitoring.
5. **Initial CSS/font diet.** Keeps Manrope, Saira, Geist Mono and Saira Condensed
   with the same UI weights; variable fonts use their Latin WOFF2 files for the
   Indonesian/English UI. Other scripts use the existing system-font fallback.
   Admin-only CSS is imported by the lazy admin route rather than the root sheet.
   No packages were installed and no visual redesign was introduced.
6. **Less repeated computation.** Catalogue names are indexed once per catalogue
   change; monitor history is indexed once per history change, with selected-stock
   lookup instead of rescanning all rows. Journal closed trades/statistics are
   memoized, and one currency formatter is reused until the currency changes.
   The existing 25-row journal pagination was already implemented and is retained;
   it is not counted as a new performance gain.
7. **Repeatable benchmark and regression checks.** Added a production-preview
   benchmark using synthetic account/API fixtures, plus catalogue-outage,
   offscreen-widget, visible-clock and lazy-admin-CSS checks.

## Measured results

Baseline: commit `1c78822`. After: this feature branch. Both use production builds,
the same local Chromium headless executable, 1218×853 viewport, reduced motion,
and synthetic API response delays: universe 300 ms, catalogue 1,200 ms. No real
account, journal or provider requests are used. Both resources finish warming
before repeat visits are measured. Timings include browser automation overhead.

| Metric | Before | After | Difference |
| --- | ---: | ---: | ---: |
| Heatmap ready after fresh document load (one sample each) | 1,352 ms | 391 ms | 71.1% less waiting |
| Heatmap ready on repeat route visits (median of five) | 1,235 ms | 16 ms | 98.7% less waiting |
| Universe + catalogue requests per repeat visit, while fresh | 2 | 0 | 100% fewer for these two endpoints |
| Root production CSS, uncompressed | 386,445 B | 372,856 B | 3.5% smaller |
| Root CSS, locally gzip-compressed for comparison | 71,392 B | 66,567 B | 6.8% smaller |

Final five repeat measurements: 44, 39, 16, 16, 13 ms. The initial viewport can
already show part of the chart: one initial TradingView script was observed in
both runs, so **no chart-load-time reduction is claimed for that viewport**.
A separate regression moves the chart genuinely offscreen and verifies zero
scripts until scrolling, then exactly one initialization.

These figures measure heatmap readiness, not complete TradingView rendering,
production Core Web Vitals, real internet latency or provider/backtest speed.
Cold-load timing has only one sample per version, not a statistically robust
distribution. No FPS, total CPU or battery percentage improvement is claimed.
The CSS gzip figure is an artifact comparison, not proof that the hosting server
actually enables gzip/Brotli. Font subsets were already conditionally downloaded
by the browser; fewer declared subsets do not imply equal network-byte savings.

## Reproduce

From `frontend/web`, build and run a separate preview (leave the user's dev server
alone):

```sh
npm run build
npm exec -- vite preview --host 127.0.0.1 --port 5175 --strictPort
```

In another shell:

```sh
SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5175 SIGNALGEN_PERF_LABEL=after node scripts/test-browser.mjs --performance
```

Use `SIGNALGEN_TEST_BROWSER_EXECUTABLE` if Chromium isn't at the runner's default
path. Runtime reports go to `output/playwright/loading-before.json` and
`loading-after.json`; these generated outputs are not committed. To reproduce
the original baseline, run the same harness against a build of `1c78822`.

Verification: production build, 232 unit tests, full workspace browser regression,
and admin-specific browser regression passed. Desktop/mobile and both themes are
covered for affected monitor details. DESIGNmd and shadcn CLI documentation fetches
were unavailable (network/DNS); existing components and official Context7 docs
were used. Existing Saira/Geist declarations triggered detector false positives;
local ignore values were recorded without changing the project's design system.
