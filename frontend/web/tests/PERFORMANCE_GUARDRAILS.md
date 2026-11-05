# Mobile performance and regression guardrails

## Changes

1. Added a repeatable mobile lab: 390×844 touch viewport, 4× CPU slowdown,
   150 ms network latency, 1.6 Mbps download and 0.75 Mbps upload.
2. Lazy-loaded Journal and moved calendar styles to date/month controls.
   Account cleanup on logout remains eager for security.
3. Added frontend CI for build, unit tests, workspace/admin browser regressions,
   mobile lab measurements and gzip bundle budgets. Reports use synthetic data.

## Local production-preview comparison

Baseline: `11e597134e59a3fe564912939b2e0fd0242019c3`.
Measurements below are one before/after CLI pair on the same local machine;
they are preliminary lab observations, not a statistical speedup guarantee.

| Metric | Before | After |
| --- | ---: | ---: |
| Workspace static dependency closure, gzip | 206,616 B | 161,589 B |
| Initial CSS, gzip | 66,567 B | 64,579 B |
| Entry JavaScript, gzip | 95,758 B | 95,789 B |
| Mobile LCP | 2,604 ms | 2,276 ms |
| Mobile CLS | 0.0123 | 0.0123 |
| Longest observed interaction (8 scripted interactions) | 48 ms | 48 ms |
| Fresh heatmap readiness | 3,653 ms | 3,687 ms |
| Median of 5 warm route revisits | 56 ms | 55 ms |

Workspace static JS is 21.8% smaller and initial CSS is 3.0% smaller.
Entry JS did not shrink. Heatmap readiness was effectively unchanged; do not
infer a general API/provider speedup from the LCP observation.

This is browser emulation, not a physical phone or production field INP.
Event Timing records the largest observed interaction; it is not field p75 INP.
API routes are synthetic controlled-delay fixtures; network emulation shapes
local assets, not a real provider. External widgets are blocked during the lab.
No production telemetry or account data is collected/uploaded by this test.

## Reproduce

From `frontend/web`, run `npm run build`, then start `npm exec -- vite preview
--host 127.0.0.1 --port 5174 --strictPort` in another terminal.

```sh
npm test
npm run check:budgets
npm run test:browser
npm run test:admin
npm run test:mobile-performance
npm run check:lab
```

Set `SIGNALGEN_TEST_BASE_URL` for a different preview port. Test reports are
written under `output/playwright/`; `SIGNALGEN_PERF_LABEL=before` saves a
separate baseline mobile report. Playwright CLI is preferred when available;
the installed Playwright runner is the CI fallback.

## Regression limits

`performance-budgets.json` caps entry JS at 105,000 B gzip, workspace static JS
at 175,000 B and entry CSS at 65,000 B. The manifest traversal includes static
dependencies once, excludes dynamic imports, and verifies Journal stays lazy.

Mobile regression limits are LCP ≤6,000 ms, CLS ≤0.1 and observed interaction
latency ≤500 ms. These are CI guardrails with host-variance allowance, not
claims of meeting all Core Web Vitals targets (the LCP goal remains ≤2.5 s).
Missing LCP/observer support fails; no recorded slow interaction is reported
as unavailable, never as a measured zero.

The workflow runs on frontend pushes and pull requests. Repository owners must
separately require its status in branch protection to block merging on failure.
Local passing checks do not establish that the remote workflow has passed.
