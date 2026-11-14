# Workspace insights

The frontend uses the existing portfolio ledger and dataset APIs. No backend routes or dependencies were added.

- Journal month filters use the sale's Singapore calendar month. Cost basis is calculated from the full transaction history before filtering, so earlier purchases remain included. All-time totals come from the server; monthly totals come from the reconciled sale records.
- CSV exports contain transactions for the selected market, portfolio and execution month. Timestamps are labeled UTC. Exported names and notes use the shared spreadsheet formula protection.
- Historical studies can keep one completed reference for comparison with a subsequent run. This reference is in memory, is scoped to the account and is cleared on reload or account change. Partial current results are labeled.
- Historical snapshot coverage comes from the accepted manifest. The latest available session is not the collection time or a live price.
- Dashboard P&L shows the last successful fetch time in SGT. IDR and USD remain separate.
- News loads the YouTube player only after Play. Changing video returns to its thumbnail.

React Bits adaptations: CountUp drives a short numeric transition; Stepper displays real run stages; AnimatedList adds viewport entrances while retaining existing list semantics and links. These small app-specific versions use native browser animation instead of adding a motion runtime. MagicBento reuses the existing component for dashboard resources. See `src/components/react-bits/LICENSE.md` for upstream terms. Reduced-motion users receive static states.

Collector job monitoring remains unavailable: the current backend exposes no collector job-status/control route. No collection status is inferred from a dataset date.

Verification uses synthetic accounts and provider responses; it does not create trades in the user's account. Run `npm test`, `npm run build`, `npm run check:budgets`, `npm run test:browser`, `npm run test:study`, `npm run test:market-screen`, `npm run test:backtest` and `node scripts/test-portfolio.mjs` from `frontend/web`. Browser checks need the configured Playwright/Chromium executable and the local frontend running.
