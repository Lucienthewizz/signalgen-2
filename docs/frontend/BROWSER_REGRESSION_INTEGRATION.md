# Browser regression integration — 12 November 2026

The general workspace and scoped market-screen browser suites passed on
`frontend/browser-regression-integration`, based on
`3ee6f3aa684e805c78f6f0d9af484c58ee64ae2c`. This preserves the historical
screening, incremental IDX collection, scheduler and retention source at that
base; the browser fixtures do not exercise the real collection service.

Commit `1ed360fe2a75c614913d560e9a7efc2cba143c2f` was cherry-picked as
`31858ee`. Its original branch and separate worktree were left untouched.
The fix scopes EMA options to the open listbox, waits for selection and
validation state, and asserts the saved `EMA9`/`EMA20` operands alongside
`CROSS_UP` and `BUY`. It retains rejection of self-comparison and the assertion
that invalid criteria never reach the API. No product implementation changed.

## Reproduce

Restore the locked dependencies with `npm ci` in `frontend/web`. Build the WASM
artifact from this checkout as documented in the frontend README, including the
matching runtime and generated SHA manifest. This verification built
`backend/cmd/wasm` and `backend/cmd/wasmmanifest` locally with Go; generated
assets and build output are ignored and are not committed.

Run `npm run dev -- --port 5181` in `frontend/web`, then:

```sh
SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5181 npm run test:browser
SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5181 npm run test:market-screen
npm run typecheck
npm test
npm run build
npm run format:check
```

Both browser commands used the installed Playwright CLI via
`SIGNALGEN_TEST_PLAYWRIGHT_CLI=/Users/lucienyudistirapurnawarman/.codex/skills/playwright/scripts/playwright_cli.sh`
and headless Google Chrome with a fresh, isolated context per suite. Port 5181
was unused before this worktree started its own Vite process.

## Results and boundaries

- General browser suite: passed its final completion assertion, including the
  former EMA 9 timeout, self-comparison rejection, correction to EMA 20 and
  saved operand checks. It covers ten workspace routes at 1440/390px in the
  product's dark theme, public/account routes, history/evidence/CSV, monitor
  sorting, sidebar behavior and expired-session cleanup. Rule preview checks
  include Escape and focus restoration; indicator layouts additionally check
  forced light/dark styles at desktop/mobile sizes.
- Market-screen suite: passed with real Go/WASM and native IndexedDB, 23 stocks
  in three batches, pagination, partial coverage, restart, Stop and 1440/390px
  forced dark/light layouts. Account, catalog, provider and private decisions
  are synthetic API fixtures. This is not a live backend/provider integration.
- Typecheck, frontend unit tests and production build: passed.
- `npm run format:check`: failed in five unchanged, out-of-scope files:
  `src/lib/market-news.ts`, `src/styles/foundation-shell.css`,
  `src/styles/news-journal-details.css`, `src/styles/workspace-compatibility.css`
  and `src/styles/workspace-surfaces.css`. The global check still fails;
  this delivery does not claim every repository check passed. The
  [format-check output](../evidence/browser-regression-integration-format-20261112.txt)
  preserves the failure.

## Follow-up acceptance and baseline formatting debt

The coordinator accepted a baseline formatting exception for this browser-regression
task only, conditional on proving that the five flagged files were unchanged and
that relevant changed-source checks passed. Those conditions are verified:

- Direct byte comparisons show `base == HEAD == working tree` for all five files
  against `3ee6f3aa684e805c78f6f0d9af484c58ee64ae2c`. Their Git blob IDs,
  SHA-256 hashes and byte lengths are recorded in the
  [baseline evidence](../evidence/browser-regression-integration-format-baseline-20261112.json).
- `package.json` and `package-lock.json` are also byte-identical to that base.
  Feeding each flagged file's exact base contents to locked Prettier 3.9.6 with
  its original `--stdin-filepath` reproduces exit 1 for all five. The integration
  diff changes no formatter configuration or inputs for those files.
- `node --check` and the scoped Prettier check passed for
  `frontend/web/tests/browser/workspace-regression.cli.js`; its existing
  whole-file `prettier-ignore` remains intact. `git diff --check` from the base
  also passed. The previously completed browser suites, typecheck, unit tests
  and build are reused; this follow-up changes documentation/evidence only.

Scoped browser-regression acceptance is complete under that exception. The
repository-wide `format:check` remains failed and its five baseline issues remain
outstanding for separate work. Original task `task_c38ae3f02afc` retains its
historical failed outcome; follow-up task `task_c4cf0e422870` records the verified
exception without rewriting the original result.

The generated rule-editor mobile/dark and desktop/light screenshots were visually
inspected, along with the market-screen mobile/light screenshot. No new visual
or product defect was identified in those bounded views. This does not establish
full accessibility compliance, real-account authorization, Yahoo availability,
collection/retention runtime behavior or production capacity.

Machine-readable results: [browser regression evidence](../evidence/browser-regression-integration-20261112.json).
