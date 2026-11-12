# Professor revisions integration — 12 November 2026

The combined branch `frontend/prof-revisions-integration` passes all requested
integration checks, including the full frontend format check. It combines the EMA 9 regression fix, screening performance baseline and backtest
evaluation choices. No product fix or test-selector change was needed during
integration.

## History and scope

Fetched branch tips matched the coordinator's specified commits before merging:

| Branch | Verified tip | Integration merge |
| --- | --- | --- |
| `frontend/browser-regression-integration` | `077d49e1434099e6a6a94b73f7e1532bcc7cda98` | Starting point |
| `frontend/screening-performance` | `e1e8d99f552f99e135b036b525625fb511ae869b` | `7e0dd9b1402a1d9e23c9f428ee108596a8501f7b` |
| `frontend/backtest-evaluation-options` | `3628ffc42dfd68a498c12b19d93ea9da972711a7` | `ffa5b40d367b730459ad958e9ade3ef9510597aa` |

Both merges preserve their source history and needed no conflict resolution.
Base `3ee6f3aa684e805c78f6f0d9af484c58ee64ae2c` remains an ancestor. The entire
backend tree is unchanged from that base, including collection, scheduler and
retention; its tree ID is `7d48fd5d7848975189a18cb8832d0ffd1f8f33b4`.
Backend runtime checks were therefore not repeated.

Separate commit `cb4a99eb66eae0496d5f24ee4a0a370498306571` formats only the five
previously flagged news/workspace files with locked Prettier 3.9.6. Every changed
file was checked against the exact output of formatting its pre-commit contents.
No manual semantic change, formatter configuration change or dependency change
was included. Historical branch reports and original failed task outcomes remain
accurate snapshots; their formatting exception is no longer needed on this
combined branch.

## Combined verification

Commands ran from `frontend/web` unless stated otherwise:

| Command/check | Result |
| --- | --- |
| `npm test` | 258 passed; zero failed, skipped or cancelled |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; final build followed complete WASM/runtime/manifest generation |
| `npm run check:budgets` | Passed; entry JS gzip 96,905 B, workspace static JS gzip 163,755 B, entry CSS gzip 64,584 B |
| `npm run format:check` | Passed for all configured targets |
| `git diff --check 3ee6f3a HEAD` and staged diff | Passed |
| `npm run test:browser` | Passed; general workspace, rule editor and EMA operands, history/CSV, monitor/sidebar, session fixtures |
| `npm run test:market-screen` | Passed; 23 stocks in three batches, real WASM/IndexedDB, partial coverage, pagination, restart and Stop |
| `npm run test:study` | Passed; existing real-WASM study, partial retry, pagination/CSV, storage limits and cancellation assertions |
| `node tests/browser/evaluation-options.mjs` | Passed; all three methods, exact Open/Close, negative/unhit and incomplete results, SL-first, CSV, empty/error/loading and keyboard states |

Browser commands used `SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5181` and the
existing Playwright CLI wrapper through `SIGNALGEN_TEST_PLAYWRIGHT_CLI`, with
headless Google Chrome and a fresh isolated session per suite. This worktree
started its own Vite server on the unused port and stopped it afterward. Build
never ran alongside Vite browser checks.

The general suite covers ten workspace routes at 1440/390px in the product's
dark theme, with additional forced light/dark indicator and heatmap assertions.
Market-screen, study and evaluation suites cover 1440/390px forced light/dark
styles; these forced styles do not change the product's dark-only policy.
Evaluation comparison screenshots at mobile/dark and desktop/light, plus the
full mobile target-mode page, were inspected. Wide tables retain internal
horizontal scrolling; keyboard focus, Tab and mobile ArrowRight checks passed.

Matching Go/WASM was rebuilt locally using `GOOS=js GOARCH=wasm go build
-trimpath`, the matching `wasm_exec.js` and `go run ./cmd/wasmmanifest`.
The initial runtime copy failed because the generated file was read-only; making
that file writable allowed regeneration. An initial build packaged the binary
before the manifest refresh completed; after browser checks and Vite shutdown,
a final build resolved
that packaging mismatch. Both public and production-build binary/runtime hashes
now match their manifests, and the two manifests are byte-identical. Generated
assets, build output, browser profiles and screenshots are not delivery files.

## Evidence limits

All browser account/API/provider/private decisions are synthetic. General
workspace screening computation is mocked; the other three suites use the real
application worker, Go/WASM and IndexedDB. No live backend/provider or production
validation, cloud mutation, manual screen-reader session or physical-device
validation was performed.

Performance samples remain the original benchmark at product base `3ee6f3a`,
recorded by `84e5a9dc0be7ba26ea57c10278d3398829099721` and documented through
`e1e8d99`, on its original M5/macOS/Chrome/Vite-port-5183 environment. They were
not rerun here. No optimization was implemented or measured, and 1000-user
capacity has not been demonstrated.

Target-hit timestamps identify daily candles, with no intraday timing or execution
guarantee. A separate aggregate target-hit rate remains absent; win rate includes
positive unhit time exits. Overlapping independent signals do not establish a
combined portfolio return.

[Structured commands, results and hashes](prof-revisions-integration-20261112.json).
