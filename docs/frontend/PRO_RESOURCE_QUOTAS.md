# Approved resource capacities

Approved 13 October 2026: Analyst allows 10 custom rules and 5 saved stock universes; Pro allows 50 and 20. System rules do not consume capacity. Symbols per universe and dataset/run limits are unchanged. No new payment, live-feed, accuracy or unlimited claims.

Postgres repositories serialize creation per owner with a transaction advisory lock, read the current paid plan under a shared subscription row lock, and check the owner resource count before insertion. Existing operator grants retain the Analyst baseline capacity; this does not grant screener access. An inactive, future or expired Pro subscription does not retain Pro capacity. Cancellation scheduled at period end retains capacity until expiry. Downgrades preserve existing records and permit updates/deletions; creation resumes below the applicable limit. No schema migration or account/subscription mutation is needed.

`GET /api/v1/subscription/plans` includes server-owned `limits`. The private, no-store `GET /api/v1/subscription/usage` requires bearer and app session, returns effective `limits` and owner-scoped `used` counts, and ignores client owner/tier parameters. Creation rejects excess capacity with `RULE_LIMIT_REACHED` or `UNIVERSE_LIMIT_REACHED` (409). UI quota errors do not fabricate a limit.

Verification: frontend's 64 tests and production build passed; Go subscription and API suites passed, including anonymous usage rejection and authenticated-owner projection. The optional `TestLockedLimitsReadOnlyDatabase` passed against the configured database without writes. No destructive or concurrent creation tests were run against cloud accounts. Existing isolated-Postgres mutation/concurrency tests require a local test database; never point them at Supabase.

Browser: Playwright CLI inspected the public package page with desktop dark and mobile light layouts. Repeatable smoke check (run frontend/backend first):

```sh
playwright-cli -s=quota-check open http://127.0.0.1:5174/#app/subscription
playwright-cli -s=quota-check run-code --filename frontend/web/tests/browser/pro-quotas.cli.js
playwright-cli -s=quota-check close
```

If Chrome is unavailable, use `open --config <local-cli-config.json>` with an installed browser executable. Browser output/screenshots stay in ignored `.playwright-cli/`; never save real credentials in browser fixtures. Authenticated quota UI still requires a real user session or isolated mocked test fixture.
