# Journal explorer and Google login polish — 10 November 2026

Frontend-only follow-up to `GOOGLE_JOURNAL_INTEGRATION.md`.

## Delivered

- Local four-color Google vector mark, pending feedback, callback progress and
  recovery navigation. Login restores an allowlisted internal destination from
  the per-tab PKCE proof; external URLs and arbitrary hash values are rejected.
- Fixed the shared button hover rule overriding Google's light-mode background.
- Archive search (stock/rule), rule/signal/market filters, inclusive screening-date
  ranges in SGT, deterministic newest/oldest/symbol ordering, and reset controls.
- Read-only details: price, signal, market, interval, SGT timestamps, stored
  indicators, reason codes, checksum and rule hash. Keyboard focus moves to the
  detail heading and returns to its trigger when closed.
- CSV includes every filtered result, not just the current 25-row page. Reuses
  the existing CSV escaping/formula-injection protection. UTC timestamp and SGT
  date columns are labeled explicitly; currencies are not combined.
- Filter-aware signal counts and most frequent stock/rule. Unspecified signals
  stay unspecified; counts are not profit, win rate, or broker execution metrics.
- `SCREENING_RECEIPT_INVALID` switches from retry to an explicit Run screening
  again action. Saved rows remain intact. Nothing automatically re-screens or
  resubmits an invalid receipt.
- Journal CSS follows its lazy route. No new dependency, API, database migration,
  browser data cache or change to account/provider configuration.

## How to check

1. Login/Register: check the four-color Google logo, disabled/pending state and
   email fallback. A real Google login still needs the provider configuration.
2. Run screening, select matched stocks, review and explicitly save to Journal.
3. Journal: combine search, rule, signal, market and SGT date filters; change sort.
   Changing filters resets pagination. An empty match set offers Reset filters.
4. View a row's details; use keyboard navigation and Close details. Metadata is
   read-only. On mobile, the table scrolls horizontally within its own container.
5. Export filtered CSV and compare with the filtered count across all pages.
6. If the API restarts or a receipt expires, save reports invalid proof; use Run
   screening again. Ordinary transient storage errors still retry unsaved rows.

## Verification

- Production build, 245 unit tests, gzip bundle budgets and mobile lab gate pass.
- Production synthetic browser suites pass: Google OAuth (desktop/mobile,
  dark/light, duplicate/cancelled/expired callbacks and return-to-Journal), archive
  explorer (filter/date/sort/detail/focus/CSV/pagination/empty/layout), and admin.
- Development-fixture suites pass: all 10 workspace routes at two viewport sizes,
  and the full screening selection/partial-save retry/outage/receipt-expiry flow.
- The earlier browser failures are now covered by passing local checks. CI starts
  a separate dev server for suites that mock `/src/analysis/screener.ts`, while
  auth/explorer/admin/mobile continue to exercise the production preview.
- Screenshots inspected at desktop/mobile and dark/light. Fixtures use synthetic
  identities and block external providers. No real account data was written.
- Mobile synthetic lab: LCP 2,276 ms, CLS 0.0123, maximum observed interaction
  56 ms (8 samples). This is not a physical-device measurement or field p75 INP.

Remote CI status must be checked separately after pushing. Real Google provider
activation/login is not established by these fixture tests. Backend is unchanged.
