# Target-hit metrics evidence

Verified on 12 November 2026 in the existing isolated
`backtest-evaluation-options` worktree, on new branch
`frontend/target-hit-metrics`, starting from integration commit
`757c7e6c338c7c875d3476a99f5270977c2f0efa`. The prior evaluation branch was
preserved. Changes are confined to Go signal-study counters/focused tests,
frontend metric types/merge/presentation/panel, dedicated tests and these docs.
No API admission, dataset capacity, marketdata cache, scheduler, retention,
shared CSS, dependency or other worker's files changed.

## Results

| Check | Actual result |
| --- | --- |
| Scoped Go core tests, `go test -count=1 -timeout=90s ./core -run TestSignalStudy` | Passed in isolated Docker; includes three new focused tests plus existing signal-study tests. |
| `npm test` | 262 passed, zero failed/skipped/cancelled; includes four new metric tests. |
| `npm run typecheck` | Passed. |
| `npm run format:check` | Passed globally. |
| `npm run build` | Passed after matching WASM generation, with Vite stopped. |
| `npm run check:budgets` | Passed: entry JS gzip 96,906 B; workspace static JS gzip 163,748 B; entry CSS gzip 64,584 B. |
| Dedicated `node tests/browser/target-hit-metrics.mjs` | Passed through Playwright CLI, installed headless Chrome, fresh browser session. |
| Existing `npm run test:study` | Passed with real rebuilt WASM and synthetic 23-stock partial/retry, pagination, cancellation and CSV cases. |
| Existing `node tests/browser/evaluation-options.mjs` | Passed with exact, target and TP/SL modes across both widths/themes. |
| `git diff --check` | Passed. |

Browser tests used only this worktree's unused port 5182; all API/account/catalog/
provider/private-signal responses were synthetic and external origins were blocked.
The app, worker, Go/WASM and IndexedDB were real. No build ran alongside Vite.

## Deterministic acceptance cases

The browser fixture contains 23 stocks in three unequal batches and 64 signals.
There are 63 evaluated outcomes and one incomplete. One signal reaches TP, while
62 positive time exits do not. The UI displays **1/63, 1.59% target reached rate**
separately from **100% win rate**. In TP/SL mode, the one TP candle also touches SL:
SL-first yields **0/63, 0% TP exit rate**, while win rate is **62/63, 98.41%**.

The first event page has 50 rows and the second has 14. Counts and rate remain
unchanged after switching pages or exact T+X. The target summary CSV exports
whole-run numerator, evaluated/missing counts, frozen window/TP/SL/policy and
coverage. Existing events CSV retains 641 rows: header plus 64 signals ×
(nine exact outcomes + one window outcome).

The matrix covers 1440×1000 and 390×1000, light and dark themes, with reduced
motion enabled. It checks labels, keyboard tab order and table scrolling,
populated/empty/pending/error states, Stop, CSV and document overflow. A known
empty target run shows `— · 0/0 evaluated · 0 incomplete`; no TP configuration
shows unavailable and disables the summary export. A simulated legacy engine
response removes only the optional counters after real WASM computation: the UI
shows reload/rerun guidance and disables the export rather than reporting zero.

Core tests also cover a positive unhit time exit, early TP with fewer future
candles than the full window, TP/SL collision, incomplete outcomes, BUY/SELL
collision policy, empty/no-TP runs, per-stock/day counts, and old/new JSON readers.
Frontend tests verify weighted rates across mixed batch sizes, unknown legacy
contributions in both merge orders, zero denominators and unchanged win rates.
The optional response field preserves schema, worker and execution-policy IDs;
see [the contract explanation](../backend/TARGET_HIT_METRICS.md).

[Machine-readable browser result](target-hit-browser.json).
Counter screenshots were inspected in
[desktop dark](target-hit-desktop-dark.png),
[desktop light](target-hit-desktop-light.png),
[mobile dark](target-hit-mobile-dark.png) and
[mobile light](target-hit-mobile-light.png).
The suite also writes full populated-screen captures under the ignored
`frontend/web/output/playwright/target-hit-*.png`; the desktop dark capture was
inspected with the win-rate table and controls.

## Reproduction and isolation

Go checks used the pre-existing `golang:1.27.2-bookworm` image with no external
network, read-only root/source/toolchain, dropped capabilities, no-new-privileges,
non-root UID/GID 65534, two CPUs, 1536 MiB memory, 128 processes, 128 MiB per-file
limit, 180-second outer deadline and a 1 GiB writable executable scratch tmpfs.
The child environment was empty except for PATH, scratch HOME/TMPDIR/GOCACHE/
GOMODCACHE, GOPROXY/GOSUMDB disabled, GOTOOLCHAIN=local and CGO_ENABLED=0.
The final command above passed after adjusting the scratch execution/file-size
limits needed by the compiler; those setup failures are resolved.

Matching WASM/runtime/manifest were rebuilt from this source in a network-disabled
Docker build with read-only source and a dedicated writable scratch directory.
The runtime SHA matched the existing runtime. Generated artifacts/caches were
excluded from Git and the dedicated build scratch directory was removed.

From `frontend/web`, after matching artifact generation and with the local dev
server running on port 5182:

```sh
SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5182 node tests/browser/target-hit-metrics.mjs
SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5182 npm run test:study
SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5182 node tests/browser/evaluation-options.mjs
```

Set `SIGNALGEN_TEST_PLAYWRIGHT_CLI` when the existing CLI is outside PATH. The
standalone runners can also use the locked Playwright package. No optional tool
or dependency was installed.

## Limits

No live provider, production entitlement, cloud mutation, physical-device,
manual screen-reader, full WCAG audit or production-capacity claim. The retained
metric is a policy-resolved TP outcome count; with SL enabled it does not count
later target touches after SL, including a collision that the policy resolves
as SL. Daily timestamps identify candles, not intraday sequence or broker fills.

Graph-first discovery used this worktree's refreshed index and exact-path
coverage checks. Changed/new paths with stale/untracked metadata were read
directly. The prior session's Impeccable context launcher was unavailable; existing
project context/PRODUCT/DESIGN and craft guidance were reused. Shadcn and DESIGNmd
CLIs remained unavailable, so existing wrappers/tokens were preserved. Context7
controlled-select guidance and the required writing reviews were reused.
