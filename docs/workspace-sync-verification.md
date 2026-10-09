# Workspace sync — 9 October 2026

## Activated

- Supabase migration `20261009114231_workspace_sync.sql` applied to the Signalgen project.
- Local Go API rebuilt and running. `GET /api/v1/workspace` and `PUT /api/v1/workspace/:kind` require the authenticated owner and an app session.
- RLS enabled; `anon` and `authenticated` have no direct table access. The trusted server role follows the existing backend policy model; repository queries always constrain `user_id`.
- Supported state: rule draft, screener preferences, watchlist, and ten recent screening snapshots. Snapshots are unverified presentation state, not authoritative trading records. Journal entries and permissions are not synchronized by this feature.
- Version-checked writes return 409 rather than silently overwriting a different device's edits. The UI offers an explicit account/device choice. Offline copies remain usable.
- Restore occurs when the workspace opens or reloads, not via a real-time subscription. Existing device/session restrictions still apply.

## Verification

- Frontend: 64 unit/contract tests passed, including token-refresh races, owner-scoped storage, offline fallback, conflict choices, and edits during an in-flight save.
- Production frontend build passed.
- Go test suite passed. Opt-in isolated Postgres integration tests were not enabled in this run.
- Browser: live three-stock screener completed, result filtering and stock detail worked; chart uses daily interval. Draft and watchlist round trips were confirmed in the real account and Supabase, then temporary draft text/watchlist symbol were restored to their original state.
- Smoke checks: overview, rules, screener, journal filters, stock universes, account/devices, subscription, Market Monitor, and news/video rendered. Light/dark switching and a 390px responsive check were exercised; no errors appeared in the captured final browser console. These checks do not constitute exhaustive testing of every destructive/account-management action.
- Two separate physical devices have not been used for a simultaneous live conflict test; concurrent edits are covered by mocked sync tests and backend conflict-response tests.

## Operating notes

- Local `.env` files were not edited. Never commit database credentials.
- Run `npm test` and `npm run build` from `frontend/web` for frontend checks.
- Run `go test ./...` from `backend` with the project's Go toolchain for backend checks.
- Browser checks avoid logout, role changes, subscription cancellation, and revocation of the user's device.
