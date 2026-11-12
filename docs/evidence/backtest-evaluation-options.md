# Backtest evaluation options evidence

Verified locally on 12 November 2026 in the isolated
`backtest-evaluation-options` worktree, branch
`frontend/backtest-evaluation-options`. The required base
`3ee6f3aa684e805c78f6f0d9af484c58ee64ae2c` is an ancestor of HEAD.
The change is confined to the assigned panel, a pure presentation helper and its
unit tests, a dedicated browser suite/runner, and these documentation/evidence
files. Core types, orchestration, shared styles, package dependencies, backend
collection/scheduler/retention and other workers' files were not changed.

## Actual checks

| Check | Result |
| --- | --- |
| `npm test` | 258 passed, zero failed; includes three new presentation tests. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; generated output remains ignored. |
| Scoped Prettier check | Passed for panel, helper, unit tests and dedicated runner. The CLI scenario follows the existing `prettier-ignore` expression format. |
| `node tests/browser/evaluation-options.mjs` | Passed through cached Playwright CLI and headless installed Chrome, fresh browser session, real app/worker/Go-WASM/IndexedDB, synthetic API responses. |
| Existing `npm run test:study` | Passed through Playwright CLI with local port 5182; existing 23-stock partial/retry, pagination, CSV, quota rollback, cancellation and timing regression suite. |
| `git diff --check` | Passed. |

The matching Go/WASM artifact was built locally using `GOOS=js GOARCH=wasm go
build`, matching `wasm_exec.js`, and `go run ./cmd/wasmmanifest`. Generated WASM,
node_modules, browser profiles, caches and build output are not delivery files.
Browser checks used only this worktree's unused port **5182**, no live backend.

## Deterministic browser cases

Three synthetic BUY signals occur on 20 January with reference Close 100, within
a 1–31 January signal search and a separate three-candle evaluation window.
Two have sufficient future candles; one has none after the signal.

- Exact T+3 Open is 92: **−8% average**, 0/2 wins, one incomplete.
- Exact T+3 Close is 90: **−10% average**, 0/2 wins, one incomplete.
- Target-only at 5%: TEST00 first touches price 105 on **T+1,
  21 January 2026 00:00 UTC**, then finishes lower. TEST01 never hits the target
  and uses final Close −10%; TEST02 remains incomplete. The comparison shows
  **50% win rate and −2.5% average**, with 2 evaluated / 1 incomplete.
- TP 5% / SL 3%: TEST00 touches both on T+1; the existing SL-first policy reports
  price 97 / −3% with that candle timestamp. TEST01 also reaches SL.
- Changing the exact result selector to T+1 updates the Open/Close comparison
  without altering the frozen T+3 barrier window.
- Each events CSV has **31 rows**: header plus three signals × (nine exact
  outcomes + one window outcome), independent of the visible result selector.

The matrix covers **1440×1000 and 390×1000**, each in light and dark themes,
with reduced motion enabled, all three methods, populated results, empty signals,
a synthetic server error, pending preparation and Stop. Native field labels and
keyboard tab order were checked; the focused comparison region scrolls horizontally
with ArrowRight on mobile. Document width never exceeds viewport width; wide
financial tables retain their existing internal horizontal scrolling.

[Machine-readable result](backtest-evaluation-options-browser.json).
Screenshots inspected for layout, labels and rendered numbers:
[desktop dark](backtest-evaluation-options-desktop-dark.png),
[desktop light](backtest-evaluation-options-desktop-light.png),
[mobile dark](backtest-evaluation-options-mobile-dark.png),
[mobile light](backtest-evaluation-options-mobile-light.png).

## Tooling and evidence limits

Graph-first discovery used the worktree index, `search_graph`, `trace_path`,
`get_code_snippet` and path coverage checks. Original source paths had no recorded
coverage issue. Modified/new paths were read directly when coverage reported
changed/untracked metadata; graph absence was not used to infer missing behavior.

The Impeccable context launcher returned permission denied; existing project
context, PRODUCT/DESIGN and applicable Operate/craft guidance were read directly.
The shadcn CLI was unavailable (`npx --no-install` reported the package missing),
and DESIGNmd CLI was not on PATH. No optional CLI or component was installed;
existing Base UI wrappers and native select conventions were reused. Context7
React controlled-select documentation was consulted. Writing, accessibility and
interface-copy reviews were scoped to the changed surface.

No manual screen-reader session, automated full WCAG audit, real account,
production entitlement test, live provider coverage run, cloud mutation or
production-capacity measurement was performed. Daily timestamps identify the
first observed hit candle, not intraday time or guaranteed execution. Separate
aggregate target-hit rate remains unavailable in the existing output contract;
win rate explicitly includes positive unhit time exits. No combined portfolio
profit is derived from overlapping signals.
