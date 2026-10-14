# Repeatable browser regression suite

Start the frontend on port 5174, install the Playwright CLI and its browser, then
run `npm run test:browser` from `frontend/web`. For a non-default browser binary,
set `SIGNALGEN_TEST_BROWSER_EXECUTABLE` for that command only. The runner creates
an isolated headless session and closes it on completion/failure. It does not edit
environment files. Screenshots are written to the OS temporary directory.

The fixture intercepts all API traffic and blocks third-party requests. No real
user, grant, subscription, database, provider or session is changed. Fixture auth
values are deliberately nonfunctional. Unknown API calls receive empty fixtures,
not a pass-through to a live backend.

Coverage:

- Ten workspace routes at 1440px and 390px in both themes (40 combinations).
- Account and six public/auth routes at the mobile size.
- Restored screener history, frozen rule evidence, comparison and CSV download.
- Monitor percentage sorting without changing the selected chart.
- Sidebar stays open on navigation; explicit close works at both viewport sizes.
- A mocked 401 clears local auth and navigates to login.
- No uncaught page errors, route-boundary failures or horizontal page overflow.

These are bounded browser regressions, not proof of every possible interaction,
real-account authorization, provider availability or full accessibility compliance.
Destructive operator/account/payment operations are not executed. Third-party
iframe/script requests intentionally blocked by fixtures may emit network-console
errors; uncaught application errors still fail the suite. Unit/contract tests
cover permission, storage conflict, expiry and quota cases independently.
