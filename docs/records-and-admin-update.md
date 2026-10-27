# Backtesting, journal and admin delivery — 27 October 2026

## Backtesting

- Consistent panel geometry, metric separators, centered tabular figures and column dividers. Existing chart dates/equity values, horizon comparison, trade paging and CSV exports remain.
- New runs save locally and upload a separate immutable server archive. History combines device and server copies, shows sync state and supports explicit retry for device-only runs.
- Server archives require current backtest entitlement and an active app session. Ownership is derived from the verified account, never from JSON.
- Ten runs / 50 MiB per account; 8 MiB per server upload. Oversized runs remain local, with a visible sync error. Existing local archives can be synced individually.
- A clean browser can restore the full report without fetching candles or scoring a rule again. Deleting synced history removes the server copy and current device copy; other devices reconcile synced caches when history refreshes. Unsynced device-only runs are preserved.
- Archives are unverified client simulations, not journal trades or broker records. Simulation policy is unchanged (`backtest-2`, daily long-only holding periods). Advanced simulation is outside this delivery.

## Trade journal

- Replaces all hardcoded sample rows with private server records. No synthetic performance fallback on unavailable storage.
- Create, edit/close and confirmed delete with optimistic version checks. Stable create IDs permit a safe identical retry after an interrupted response.
- Quantity is stored in shares. IDX input is whole lots of 100 shares; US uses shares. Recorded short positions reverse the price delta; neither workflow sends broker orders.
- Server derives realized net P&L from quantity, entry/exit prices and absolute fees with decimal arithmetic before currency rounding. Open trades have null realized P&L.
- Currency, journal, instrument and month filters drive both the ledger and chart. IDR and USD are never summed together. No invented MFE, MAE, unrealized prices or broker verification.
- Maximum 1,000 records per account. Trade dates are calendar dates, not exchange-tick timestamps. Dividends, corporate actions, borrow charges and tax are not inferred; enter applicable costs in recorded fees.

## Admin

- Reviewed suspend/reactivate action uses the backend's existing status compare-and-set endpoint, reason validation, session revocation and last-active-operator protections.
- Persistent per-account audit log (20/page) includes actor, action, reason, time and request ID. Existing in-visit activity remains clearly distinguished.
- No changes to real members are needed for verification; browser coverage uses synthetic APIs.

## Deployment and verification

Migration: `supabase/migrations/20261027080957_journal_and_backtest_records.sql` (version aligned with the approved cloud deployment).
The private table has RLS, no grants to public/anon/authenticated, a backend owner-context policy and an indexed owner/kind/time lookup. Every store operation sets the owner transaction-locally and also uses explicit owner predicates. Per-owner advisory locks serialize quotas and writes.

Use the approved Supabase project only. Apply the migration before rebuilding the API. It adds a table, index and policy; it does not modify existing user data. Missing deployment returns a clear records-unavailable error instead of claiming persistence. Rollback should disable the endpoints and retain the table for recovery, not drop recorded trades.

Disposable SQL verification uses a network-isolated PostgreSQL container, `backend/internal/records/testdata/bootstrap.sql`, and the migration. Supply only that disposable database to `RECORDS_TEST_DATABASE_URL` for the integration test. Never use the project's live database for those destructive fixture tests.

Backend tests cover strict payloads, owner authorization, P&L, CAS, idempotent create retries, RLS context cleanup and archive retention. Browser fixtures cover both themes and responsive layouts, clean-device archive restore, journal save/error/retry/delete, and reviewed admin status/audit pagination.

Existing Supabase advisory before this change: leaked-password protection is disabled. This account-level Auth setting is not changed by the records migration. Legacy import tables also have intentional deny-all RLS without client policies.
