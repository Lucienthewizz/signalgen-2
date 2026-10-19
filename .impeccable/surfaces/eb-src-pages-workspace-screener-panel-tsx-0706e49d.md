---
version: 1
slug: "eb-src-pages-workspace-screener-panel-tsx-0706e49d"
primary_target: "frontend/web/src/pages/workspace-screener-panel.tsx"
related_targets: ["frontend/web/src/pages/workspace-rules-panel.tsx","frontend/web/src/pages/workspace-resource-panels.tsx"]
---

# Preset-led screening workflow

## THESIS
Make an indicator screen understandable before it runs: choose a starting preset, inspect editable criteria, then review a compact evidence table.

## OWN-WORLD
Extend Signalgen's existing green-black ledger, Saira workspace type and shared shadcn/Base UI controls. Landing, navigation identity, backend and database stay untouched. Stockbit's official create-rule/results flow informs task order, not unsupported financial indicators or copied branding.

## STORY
Preset → named criteria with ALL/ANY semantics and BUY/SELL → market-aware universe → run → filtered results → condition evidence and saved history. A preset fills a form only, never saves or runs silently.

## FIRST VIEWPORT
One clear composer with user-requested full-width green preset cards, editable rows and one save action. Screener exposes saved rule, small wrapping selected-stock cards and compact readable criteria before its primary run button. Shared left/right gutters remain intact.

## FORM
Compact ledger rows, a separated No column, centered desktop column headings, visible mobile labels and predictable alignment. Presets fill a responsive three/two-column green card grid as explicitly requested. Search/status filters share the result-panel gutters. Reuse existing surfaces and subtle green gradients; no decorative metric-card grid or new font. Use English, semantic status labels and keyboard controls.

## FINISH
Verify preset/validation, market isolation, BUY/SELL/cooldown filters, crossover history evidence and CSV. Run unit/build and isolated Playwright CLI in desktop/mobile and light/dark. Review screenshots with an independent finish reviewer, then compare docs without changing the incumbent design system.
