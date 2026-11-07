# Google sign-in and screening journal integration

Integrated upstream `c01e4f2` (which includes `8a0dd9a`) into the performance
guardrails branch on 7 November 2026. No external account/provider configuration,
credentials, database migration, or user journal mutation was performed.

## Merge decisions

- Retained mobile/desktop performance flags and report writing while adding the
  upstream `--auth` browser suite to the runner.
- Replaced the conflicting manual-trade Journal block with upstream receipt-only
  saving. Legacy trade records are preserved by the backend but not shown in this
  new screening archive. Manual portfolio ledger remains a separate API.
- Retained lazy Journal loading and on-demand calendar styles.
- Local environment files and pre-existing package-lock, legacy desktop and
  Impeccable changes were not included in the integration commit.

## Verification

- Frontend production build: passed.
- Frontend unit tests: 241 passed.
- Bundle budgets and mobile lab gate: passed.
- Backend `go test ./internal/auth ./internal/journal ./internal/api/tests`:
  passed in the existing Go 1.27.2 Docker image, with source mounted read-only.
  Dependencies were downloaded into the disposable container; no `.env` was used.
- Scoped synthetic OAuth functional smoke: passed, desktop/mobile dark mode.
- Scoped synthetic Journal functional smoke: passed receipt-only saves, duplicate
  click prevention, partial-write retry, pagination and outage recovery on
  desktop/mobile and dark/light CSS. The existing screener toolbar visual loop
  was excluded from this scoped run; its assertions were not claimed as passing.

The full imported browser suites did **not** pass locally:

- Google suite timed out on an exact white-background assertion in light mode.
- Journal suite needs a development server for its `/src/analysis/screener.ts`
  fixture; in development it progressed to a screener status-toolbar click timeout.
- Workspace suite timed out waiting for the mobile progressive-loading error
  notice. This also means the frontend CI browser gate is not yet verified green.

These failures remain visible in the existing suites; no assertions were removed
or relaxed to obtain a passing full-suite result. The scoped runs used the same
synthetic fixtures but isolated the functional flows described above.

Real Google sign-in is not verified: provider activation, Google OAuth client,
exact Supabase redirect allowlist, backend CORS and hosting callback fallback must
be configured and smoke-tested by the account owner. See the upstream guide at
`docs/backend/GOOGLE_SIGN_IN.md`. No paid role/entitlement is granted by Google login.

## Frontend opportunities (not implemented by this merge)

- Search/filter/sort the loaded archive by stock, rule, BUY/SELL, market and date.
- Open a read-only detail panel for stored indicators, reason codes and checksum.
- Export filtered snapshots to CSV; label them as screening, not executed trades.
- Improve receipt-expiry/restart recovery with an explicit Run screening again action.

The new archive API intentionally has no edit/delete endpoint. Do not restore
manual trade writes or promise server-side search without backend changes.
