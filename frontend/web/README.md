# Signalgen Web

## FE-only analysis usability (29 October 2026)

The API contract, backend, database and Go/WASM calculations are unchanged.

- Screener refresh keeps existing selections and results visible, with one
  in-flight resource load per panel and stale-response rejection on account
  change/unmount. Shared GET reads are not aborted out from under other readers.
  Existing transport retries remain bounded; no writes are automatically retried.
- Rows are numbered in the first column. Check verifiable matched stocks in the
  **Add to journal** column, then choose **Review selected in journal**.
  Hidden selections remain counted; checking a row never saves or navigates.
  New results clear the selection so old selections cannot refer to new prices.
- The journal queue is memory-only. Review/edit and save **each** draft explicitly
  through the existing individual record endpoint, or skip/cancel it. It is not
  an atomic batch save, broker order, permanent blacklist or auto-trade.
- Journal refresh retains previously loaded records, including on read failure.
  Search, sort and 25-row pagination affect presentation; journal summaries use
  all filtered records, not only the current page. Manual entry remains available.
- Backtest filters search/sort existing trades without changing report metrics
  or the complete-horizon CSV exports. Configuration validates existing limits.
  Old results stay labelled during a rerun/failure. No all-market or new
  Open/High/Close evaluation mode is enabled by these changes.
- **Browser performance details** in screener results separates access, snapshot
  preparation, dataset load/verification, worker startup, indicator computation,
  scoring wait and commit-to-next-frame latency. Warm/unchanged runs are marked;
  historical reports may not contain timing fields. Network-inclusive durations
  are not server CPU measurements. No credentials or telemetry are uploaded.

Run `npm run test:usability` with Vite on 5174. It uses synthetic account/API
fixtures, never real account writes, and checks selection, reviewed individual
saves, duplicate-click protection, skipped drafts, retained refresh/errors,
filtering/pagination and 1440/390px layouts. Existing `test:browser`,
`test:backtest`, `test:recovery` and `test:monitor` cover the surrounding flows.

## Claudio indicators (27 October 2026)

All 78 fixed Claudio rule operands and dynamic periods/history offsets (1–250)
are available in Rules, screener and daily backtest. Use the grouped indicator
selector and **Parameters / previous candle** on either side of a condition.
Requires API 0.14.0 and rebuilt WASM core-0.5.0; no indicator database migration.
See [formulas, availability, API compatibility and checks](../../docs/backend/CLAUDIO_INDICATORS.md).

## Admin access management (26 October 2026)

Open the workspace sidebar and choose **Administration → Admin Panel**. On mobile,
open the workspace menu first. The current menu is marked as selected; Escape
closes the mobile menu. `#app/admin` remains an alias of `#app/operator` for links.
An active backend `operator` account is required. The browser cannot grant itself
this role. [Initial operator setup](../../backend/README.md) remains an out-of-band
step for a new installation.

1. Search the registered application profiles by email or User ID, optionally
   filter by account status, and Select account. Search covers the full directory;
   Previous/Next traverse pages of 10 matching accounts.
2. Feature access loads the selected member's direct grants. Choose Screener or
   Backtest and a 7/30/90-day duration, or edit the expiry in your local timezone.
3. Add a reason, Review access grant, verify the recipient and expiry, then Confirm
   change. Review/Cancel do not write anything. Review revocation uses the same
   explicit review step.

The selected email and UUID stay visible. Selecting another member clears the
pending change. Session identity changes clear account data and pending reviews;
late reads cannot restore them. The backend still verifies the active operator
and writes the grant/revocation audit. Direct grants and subscription access are
separate; revoking a grant may leave subscription access in effect. A suspended
account remains suspended. Subscription activation and operator-role controls
remain in their separate tabs.

The API must include the optional `q` filter on `/api/v1/operator/accounts`.
Members appear after their application profile exists; signing in once normally
creates it. The directory does not enumerate all Supabase Auth identities.
The User ID fallback remains under a disclosure.

The sidebar verifies role/status through `/api/v1/account/me`; login identity
responses do not contain the application role. It rechecks on navigation, window
focus and a self-role change. A missing, suspended or unverified operator role
does not expose the admin entry. API authorization remains authoritative.

UI/UX Pro Max guidance informs the paired member/access columns, compact member
rows and grant summaries, visible labels, validation focus, 44px controls and
theme-token contrast. The columns stack on smaller screens; grant data and tabs
fit the viewport without horizontal scrolling.

Run `npm run test:admin` against Vite on 5174 for isolated Playwright checks of
search/paging, status filtering, keyboard selection, durations, reviewed grants,
revocation, failed requests, and non-operator/forged/suspended-role denial at
1440/375px and 844×390 landscape in both themes, with reduced motion.
All account/API fixtures are synthetic; this test never grants real users access.

## Basic backtesting workspace (26 October 2026)

For the 28 October presentation, use the [tested demo and study guide](../../docs/DEMO_BACKTEST_ADMIN_2026_10_28.md).

Open `#app/backtest` or **Analysis → Backtesting** with a signed-in account that
has the `backtest` entitlement and a saved stock universe. This is a functional
testing surface using the existing theme and controls; visual polish can follow.

- Rule: select a saved BUY rule, universe, UTC dates, holding period, capital,
  sizing and costs, then Run backtest.
- Manual: choose Manual, Prepare data, select a stock and completed signal candle,
  Add entry, then Run manual backtest. Preparing again replaces the snapshot and
  clears manual entries. Entry always uses the next candle's open.
- Select T+1 through T+n to inspect the independent portfolios, metrics, trades,
  skipped entries and equity values. The comparison table shows 10 horizons per
  page; its buttons support keyboard selection. The daily equity chart supports
  pointer/touch and an accessible slider; the full equity table has 25 rows/page.
  By-stock statistics describe accepted portfolio trades, with skipped candidates
  counted separately. Open positions show unrealized P&L. Loading,
  cancellation, empty results, invalid data and denied access have explicit states.

The API must support OpenAPI 0.12.0, `backtest-2` and `holding-next-open-1`.
Generate the matching WASM assets with the Docker command below before use.
Client code verifies snapshot bytes/checksum, rechecks online access and snapshot
version before each run, and sends each symbol's complete indicator history for
private server scoring. Manual mode skips rule/grant/scoring. Computation runs in
a cancellable Go/WASM worker. Schema 2 adds nullable closed-trade statistics,
expectancy, average profit/loss, average closed return and by-stock summaries.
An incompatible API/WASM version asks for refresh/rebuild.
No journal entry or broker order is created. [Backend policies and limits](../../docs/backend/BACKTESTING.md).

**Export:** Export trades CSV downloads every trade for the selected horizon,
including rows outside the current table page. Export horizons CSV includes all
horizons, currency, schema and policy. Null metrics export as empty cells. CSV
quotes and spreadsheet formula text are escaped; numeric losses remain numbers.

**Bulk manual:** expand Add multiple manual entries and paste lines such as:

```csv
symbol,timestamp
TEST,2026-01-20T00:00:00Z
TEST,2026-01-21T00:00:00Z
```

Use symbols and completed candle timestamps from the prepared snapshot. The header
is optional. An invalid or duplicate line rejects the entire batch, keeps the old
list unchanged and focuses the row errors. The combined limit is 2,000 entries.

**History:** each successful run, including no trades, saves automatically to
IndexedDB on this browser, separately per verified account. Archives retain full
results, currency, config and source/version metadata; never credentials, grants,
private rule definitions or raw candle datasets. Logout clears the screen but
keeps archives for the same account's next login. Archives are local plaintext
analysis, not encrypted historical-cache snapshots or authoritative records.
Opening checks current backtest access and needs no market data/scoring fetch.
It displays the saved result read-only with its saved currency, without restoring
an expired grant or silently rerunning its settings.

The newest 10 runs, at most 50 MiB JSON UTF-8 per account, are retained; oldest
archives are removed atomically with a new save. Oversize/quota/blocked storage
reports failure while the current result and CSV remain usable. Delete one/all
asks for confirmation and affects only this account's archives. Browser/site-data
clearing removes local history; it is not synchronized across devices.

With Vite running on 5174, run:

```sh
npm test
npm run test:backtest
npm run build
```

The browser runner prefers `playwright-cli` and falls back to the installed
`playwright` library. Set `SIGNALGEN_TEST_PLAYWRIGHT_CLI` to an executable wrapper
path to use a non-global CLI. Set `SIGNALGEN_TEST_BROWSER_EXECUTABLE` if needed.
The suite uses synthetic accounts and API/provider responses with the real
Go/WASM engine. It checks next-open P&L, rule/manual flows, open positions,
no signals, integrity/provider errors, cancellation and denied access at
1440/390px in both themes. Screenshots go to ignored `output/playwright/backtest-*`.
It additionally checks real IndexedDB persistence, count/byte limits, transaction
rollback on quota errors, corrupt records, account changes during save, reload,
logout, account isolation, archive deletion, bulk-input atomicity and CSV downloads.
It does not verify real login, provider availability or production data.

## Dashboard and journal review (21 October 2026)

Dashboard resources use larger landing-style boxes. Recent runs include glass
interval/time labels and semantic matched counts. Rules place the bracketed
filtered count beside Your rules, preserving search/filter height and row gutters.
Shared information dialogs align a larger close action with the title.

Add to journal accepts only a valid matched snapshot from the current account.
It opens a centered verification dialog **on the journal route**, with frozen
prices, currency, interval/time, indicators, condition values and crossover history.
Legacy/private rule definitions remain unavailable rather than being reconstructed.
Confirmation copies the snapshot price and known signal direction into an
**unsaved** form. Unknown legacy direction must be selected manually. Toasts
distinguish verification success from saving a transaction; no journal endpoint,
local ledger, broker order or account performance is invented.

The journal toolbar toggles Open/Close with a destructive close state. Save/Close
actions share one aligned footer. Month, instrument and book filters drive the
same table rows, summary and dated cumulative P&L chart. Chart points expose date,
closing price and cumulative IDR value on hover/focus; the axis is P&L, not a stock
quote. **Rows are still explicitly labelled sample records** until the backend
implements the authoritative journal API. This UI change does not make sample
performance into account data.

## Workspace refinements (21 October 2026)

Screener keeps rule, universe and candle interval together. Start/Stop and the
last/next check sit in the aligned bottom control bar; Stop uses the destructive
surface. Data quality and Export CSV sit after the lower signal-status filters,
not in the results heading. Data quality and screening failures open centered
Base UI dialogs with keyboard dismissal and recovery actions. Background retries
do not repeatedly reopen an acknowledged failure. Data information is a
full-width disclosure; result data remains timestamped snapshots, not live quotes.
History follows the results table, with one card per screen, compact metadata
tiles, adjacent Review/Delete actions and a confirmed Delete all action. Results
tables use centered cells, subtle column dividers, underlined details and compact
glass journal actions.

Saved universes show two compact cards, with all groups available in a directory
dialog (name left, stock symbols right on desktop). The selection card keeps its
natural content height. Rules signal filters match the search height and use
neutral/BUY/SELL semantics; workspace navigation is visually uppercase. Edit and
delete controls share restrained glass surfaces with reduced-transparency support.
Edit rules opens the composer in a dialog, keeping an unfinished editing draft
available through Continue editing. Comparison choices include mathematical and
crossover symbols without changing the saved operators or evaluation logic.

Market Monitor history deletion requires confirmation and hides the entire
selected run for this browser/account only. Device-only visibility markers are
also used by the screener history. Market Monitor's Delete all targets the
screens shown for the selected stock, explicitly including their other stocks.
Its count and destructive action share the same height. Visibility markers are
kept outside workspace sync: raw account history is not rewritten, including
when a later run is saved. Blocked storage reports failure instead of claiming a
successful deletion. Tests use synthetic account/API boundaries, never cloud
credential changes or destructive operations against real accounts.

Start–Stop monitoring: choose a rule, universe and interval, then Start. Default
5m; options 1m/5m/15m/1h/1d. Intraday begins with 3 calendar days and extends
only when fewer than 20 valid closed candles are available. At most 100 candles
per stock, 10 stocks. Stop/logout/navigation ends monitoring; reload never
auto-starts. This is periodic Yahoo historical polling, not a licensed realtime
feed. `npm run test:monitor` uses synthetic accounts/API/socket with real Go/WASM.
See [policy, contract, limitations and demo](../../docs/backend/INTRADAY_MONITOR.md).

US stocks: choose the US/Nasdaq/NYSE market in the universe editor, select 1–10
stocks, then run that universe in the screener. The catalog now imports eligible
Nasdaq/NYSE stocks from the full official directories: 5,600 at the 19 October
2026 import, not a fixed 20-symbol list. ETFs, preferred/debt, warrants, rights,
units and test issues are filtered; OTC/other US venues are not covered. The
screening maximum stays **10**, regardless of catalog size. USD stays separate
from IDX/IDR; no FX conversion. AS watchlist
keys use `US:AAPL`. See [US scope and verification](../../docs/backend/US_STOCKS.md).

Historical OHLCV/screener snapshot caching uses gzip + AES-256-GCM in IndexedDB,
scoped to a verified user/installation/API and exact manifest version/checksum.
Logout/user switch removes snapshot ciphertext and keys. Every run still checks
online authorization. See [cache security and limitations](../../docs/frontend/HISTORICAL_CACHE_SECURITY.md).
This protects browser cache at rest; it does not replace production HTTPS/WSS.

React + TypeScript + Vite is the active multi-user web application. The current
backend is Go/Gin with a Go/WASM analysis worker; Python/FastAPI is archived legacy.
Scope: `../../docs/frontend/FRONTEND_MVP_PRD.md`. Current routes follow
`../../backend/openapi.yaml`; `../../docs/backend/MVP_API_CONTRACT.md` also contains proposed targets.

```sh
npm ci
npm run dev
npm run build
npm test
```

Local preview: http://127.0.0.1:5174. Development proxies HTTP and WebSocket
requests under `/api` to the Go backend at port 8080. Production uses
same-origin `/api`, or configure `VITE_API_ORIGIN` at build time.

Includes the supplied Signalgen logo, a responsive workspace shell aligned to
the desktop application, login/register/current-user flows, password recovery,
and local-session cleanup on 401. The web-only UX preview covers the MVP analysis,
rule management, explainable results, journal, entitlement, session/device and
cache-clear surfaces. Analysis uses the live Go API + Go/WASM POC when
authenticated, while account entitlements and owner-scoped devices are read
from the Go API. User rules are persisted through the owner-scoped Go API;
unfinished rule drafts are stored separately in the browser. Journal saving
is not enabled. Analysis snapshots are historical, not live-market data.

The landing page includes an interactive feature tour using screenshots captured
from the web routes themselves. Loading feedback uses the project shadcn Skeleton
primitive; route, result, carousel and accordion transitions respect the browser's
reduced-motion preference.

Demo routes:

- `#app/overview` — feature map and integration status
- `#app/analysis` — screener configuration, Start/Stop and results
- `#app/backtest` — daily rule/manual backtesting, run/cancel and results
- `#app/rules` — read-only system rules and owner-scoped user-rule CRUD
- `#app/journal` — draft/manual transactions and example position/P&L
- `#app/access` — entitlement, devices, revoke and local cache state

Runtime backend/OpenAPI remains the source of truth for implemented calls; the
MVP contract is the target. Successful authentication needs backend and Supabase
configuration. Current screenshot values are illustrative, never live-market claims.

## Interface system

Tailwind v4 is wired through `@tailwindcss/vite`. Project-owned shadcn Base UI
primitives live in `src/components/ui`, with the `@/` alias pointing to `src/`.
The landing page retains Manrope. Other routes use self-hosted Saira for body
text, Saira Condensed for headings/navigation/buttons/table headings, and Geist
Mono for market figures. Headings use the real 600 weight, navigation uses 500,
and table headings use 700. The document-level `data-typography` route marker also covers
portalled controls and toasts. Embedded third-party charts keep their own fonts.
Typography roles live in `styles/workspace-typography.css`; colors, layout, focus
states, and reduced-motion behavior remain independent of the font selection.

## Authorization contract

Verified against the Go API `openapi.yaml` version 0.11.0 and private-screener
contract on `feature/hybrid-screener-integration`:

- `POST /api/auth/login`: JSON `{ email, password }`, returns token and public user fields.
- `POST /api/auth/register`: JSON `{ full_name, email, password }`, supports a nullable token and email confirmation.
- `GET /api/auth/me`: bearer access token, returns public profile fields.
- `POST /api/v1/sessions`: bearer access token, persistent browser installation,
  and a one-time app-session token response.
- Protected analysis routes: bearer access token plus `X-App-Session`.

Password reset request and confirmation routes are implemented by the Go API.
Logout calls `DELETE /api/v1/sessions/current` before clearing browser session
state. The installation UUID remains pseudonymous and persistent; it is not a
hardware identifier.

The web client does not import backend secrets or merge backend code. Run the Go
API branch separately on port 8080. For another API host, set `VITE_API_ORIGIN`
at build time (for example `https://api.example.com`); that backend must allow
the website's origin through CORS.

`npm test` verifies request bodies, recovery tokens, bearer headers,
confirmation responses, validation failures, and session handling using a mocked
transport. Real authentication and recovery require a configured running
Supabase-backed backend. Desktop source files are not changed by this web
revision.

## Hybrid screener POC

The analysis surface now implements the Go target flow for the frozen BBCA.JK
fixture:

1. register a persistent browser installation and short-lived app-session;
2. fetch the versioned dataset and baseline rule through the Go API;
3. verify and run the matching Go/WASM artifact in a dedicated worker;
4. request a compute grant and one-use WebSocket ticket;
5. send only the compact feature candidate batch to Go private scoring; and
6. render the server decision, reason codes, feature evidence, and data
   quality without claiming a live signal.

Generate `public/wasm/` from the matching Go source before running the frontend:

```sh
docker build -f backend/Go.Dockerfile --target wasm-artifact \
  --output type=local,dest=frontend/web/public/wasm .
```

The generated directory is intentionally ignored by Git. The worker validates
the runtime and WASM SHA-256 values from `signalgen_core.manifest.json` before
execution. It requires `core-0.4.0`, `worker-2`, and
`screener-features-1`; the system rule definition remains server-side. A real
run requires a Supabase user with the `screener` entitlement;
the guest state directs the user to sign in instead of showing fabricated data.

## Workspace layout and journal status (14 October 2026)

The overview combines the selected rule/universe, monitor/news shortcuts, account
resources, and up to five recent screening runs. “Gunakan pilihan” restores a run's
selection; it does not claim to reopen its historical evidence. Panel content uses
`--workspace-panel-gutter` for desktop/mobile alignment, including the shared header.

“Catat jurnal” opens the Trade Journal form with the stock symbol prefilled.
Server journal storage is deliberately not enabled. The form does not persist local
drafts or submit a transaction; saving is visibly unavailable. Existing browser drafts
are left untouched, and sample performance/review content is labelled as illustrative.

`npm run test:browser` checks the workspace routes in both themes, responsive overflow,
dashboard content alignment, primary Refresh styling, and journal form/non-persistence
using synthetic API/account fixtures only.

The initial account in 6 October browser verification lacked this feature and
was correctly denied. The user's replacement account already had access and
completed login-to-screening for a three-symbol demo universe: three latest
`No match` decisions, quality `complete`, one grant/ticket/socket. No permission
or role was changed. New grants still require an authorized operator, expiry
and audit reason; guards must not be bypassed. Signup/recovery lifecycle and
automatic identity refresh are not claimed complete by this successful run.
The dashboard's launch area shares a rounded, theme-aware charcoal-to-green
gradient frame. Its content, navigation, account data, and actions are unchanged;
the quick-access inset stacks with aligned gutters on narrower screens.

`styles/workspace-materials.css` owns the landing-inspired page and card gradients
for all workspace routes and account forms. Its explicit surface opt-ins preserve
controls, selected rows, notification semantics, and embedded chart canvases.
The gradients resolve existing theme tokens, have no animation or image requests,
and become solid surfaces in forced-colors mode. Browser tests check every
workspace route in both themes and two viewport sizes, including shared text
contrast against the surface stops.

Session history has display-only Delete/Restore controls. Only ended, non-current
sessions can be hidden. The preference is scoped to the account in this browser's
local storage; active/current sessions always remain visible even if their IDs
appear in that preference. No server session or audit record is deleted/revoked
by these controls. The separate End session action retains its existing behavior.

## Stock universe catalog and English interface

The stock universe editor opens with a compact group overview inspired by
[StocksUniverse](https://stocksuniverse.io/stocks): group name, sample symbols,
available catalog count, and selected count. Sort by group size or name, then click
a group to filter the bounded stock table and search below. These counts overlap
across curated groups; they are not market-cap or performance rankings.
A right-side panel holds selected stocks (up to 10), the universe
name, and the save action; it stacks below the table on narrow screens. Saved universes
are compact rows below the editor, without an enclosing card. Category/query changes reset pagination,
not the selected stocks. Company names and user-created resource names are preserved.
Website controls, descriptions, notifications, and client errors use English; external
news headlines retain their source text.

Blue chip, Banks, Energy, Consumer, Property, and Technology are explicitly **curated
browsing shortcuts**, not complete sector membership, live index constituents, or
investment recommendations. Only symbols present in the backend catalog are shown.
The category vocabulary follows [IDX product information](https://www.idx.co.id/en/products/stocks/).
Refresh category lists deliberately when issuer classifications change; unknown groups
display a dash instead of an inferred classification.

The local stylesheet owns universe spacing and the single liquid-glass save action without changing
other resource layouts. Reduced-motion and reduced-transparency preferences have static,
opaque alternatives. The layout reference is [DesignMD Command Center](https://designmd.ai/frknaykc/command-center)
for restrained operational hierarchy, not its palette or identity.

`npm run test:catalog` exercises categories, search, keyboard selection, the 10-stock
limit, pagination, loading/empty states, and both themes at 1440/900/390px using a
synthetic catalog. Set `SIGNALGEN_TEST_BROWSER_EXECUTABLE` to an existing Chromium
executable when the Playwright CLI's expected browser is not installed.

## Universe-linked Market Monitor

Market Monitor loads saved universes and issuer names from the existing API. The
first nonempty universe opens by default; choosing another universe replaces both
the selectable stock cards and table without modifying the saved universe. A card
selects the TradingView symbol and highlights the corresponding table row. The
Mac-style chart frame remains above the results table, beside a stock detail card
on wide screens. The detail card uses actual screening snapshots for open/close,
EMA 9/20, RSI 14, rule result, and data time. Sector icons represent curated groups,
not issuer logos. Hide/show cards, stock selection, previous/next navigation, and
analyze/compare focus controls share the same selection without writing a universe.
Personal watchlist mode
retains its separate add/remove workflow, including when universe loading fails.

Table values remain screening snapshots, not live TradingView quotes. Missing
snapshots display dashes and `Not evaluated`; no 7D/30D returns are fabricated.
Open-to-close percentages have a separate Change column with explicit signs,
two decimal places, green/red direction, and unsigned neutral rounded zero.
Browser regression fixtures verify universe switching, card/chart/row selection,
the retained chart frame, responsive layouts, and both themes. External chart
requests are blocked in those isolated tests, so they do not verify the live
TradingView provider.

## Decision correctness and demo checks

`matched` is a result status, while `signal_type` is the BUY/SELL direction
configured on the selected rule. Neither executes a broker order. History
preserves both direction and previous-candle features so a SELL crossover keeps
its meaning after reload and CSV export. Legacy history missing these fields is
shown as `Matched` with unavailable crossover evidence, never guessed as BUY or
recalculated using a newer rule. Rerun screening online for a fresh complete result.
Prices and CSV headings use the snapshot's IDR/USD currency without FX conversion.

Run the focused regression against your running Vite instance:

```sh
SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5174 npm run test:decisions
```

This uses synthetic API/account fixtures and checks BUY/SELL, AND/OR, crossover
history, reload, details, CSV, legacy missing fields and cooldown at 1440/390px
in both themes. It does not log into or change a real Supabase account.

Vite is pinned to 5174 with `strictPort: true`: it exits if that port is occupied,
rather than starting a second frontend on 5175. For an intentional port override,
the backend's `SIGNALGEN_CORS_ORIGINS` must include the exact browser origin.
HTTP proxying does not remove the WebSocket Origin check. After changing backend
`.env`, recreate only `go-api` to reload its environment; do not use a wildcard.

Indonesian backend walkthrough: [Match, BUY/SELL and the decision flow](../../docs/backend/SCREENER_DECISIONS.md).

## Resource loading and recovery

Account/rule/universe reads retry one transient network, timeout or 502/503/504
failure. Duplicate reads share that recovery, with no persistent authorization
cache. The 15-second browser timeout covers reading the body too; the Go boundary
cancels ordinary reads after 10 seconds. Persistent errors offer Reload selections
and distinguish timeout from an unavailable service. Outages do not clear login;
real authentication/revocation failures retain their existing security behavior.
Login, refresh exchange, saves and app-session creation are never replayed for
transient failures. See [backend limits and safe timing logs](../../docs/backend/SECURITY_HARDENING.md#slow-reads-and-transient-recovery-19-october-2026).

```sh
SIGNALGEN_TEST_BASE_URL=http://127.0.0.1:5174 npm run test:recovery
```

The isolated browser fixture checks automatic recovery, exactly two attempts on
persistent failure, timeout wording, explicit reload, preserved login and responsive
overflow at 1440/390px in both themes. It never uses a real account or cloud data.

## Registration confirmation

After a successful registration response, the form is reset and removed; password
and confirmation state are cleared. When email confirmation is required, the card
shows inbox guidance and a Continue to sign in link rather than another Create
account button. A response containing an access token retains the existing app-session
bootstrap and workspace redirect. Failed registration requests leave the form editable. Switching
auth views resets the local confirmation state. Browser regression checks use only
synthetic registration responses; they do not create users or send confirmation email.

## Rules confirmations

Replacing populated criteria with a preset and deleting a saved rule use the
Signalgen confirmation dialog instead of browser-native prompts. The dialog names
the preset or rule, focuses Cancel first, supports Escape, and returns focus to the
initiating control. Cancel leaves the draft and saved data untouched. Replacing
criteria updates only the editor; saving remains a separate action. The shared
Base UI AlertDialog supplies modal focus management and accessible title/description;
its surface uses the existing Signalgen theme tokens in light and dark modes.

Draft recovery is a text action directly below New blank rule, not a page-wide
alert. Restore draft is disabled when there is no pending saved draft or while
rules are loading/saving. New blank rule still discards the pending draft;
restoring retains the existing rule-version validation.

## Rules workflow preview

Selected starting presets show a checkmark. The composer footer distinguishes
device-only draft storage from saving a rule to the account, including storage
failure feedback. Indicator references use a dropdown; choosing Numeric value
reveals a number input. Existing rule validation still applies.

Preview criteria opens a centered, keyboard-accessible dialog showing the current
draft, signal, logic, conditions and cooldown without saving or running it. This is
a criteria preview, not market results: the current dataset/compute API requires a
saved rule ID and definition hash. Save and run the rule in Screener for results.
Saved rules can be searched by name and filtered by BUY/SELL, with condition counts
and a separate no-matching-rules state. Filters do not mutate saved rules.
