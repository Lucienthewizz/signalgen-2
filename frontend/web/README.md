# Signalgen Web

React + TypeScript + Vite web application. It currently contains public/account
work and will become the primary analysis surface under `../../docs/frontend/FRONTEND_MVP_PRD.md`.
FastAPI is the current legacy backend; the revised target is the versioned Go API
and Go/WASM worker defined in `../../docs/backend/MVP_API_CONTRACT.md`.

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
from the Go API. Rules and journal remain local preview state that persists
across hash-route changes, resets on reload, and never represents live-market
data.

The landing page includes an interactive feature tour using screenshots captured
from the web routes themselves. Loading feedback uses the project shadcn Skeleton
primitive; route, result, carousel and accordion transitions respect the browser's
reduced-motion preference.

Demo routes:

- `#app/overview` — feature map and integration status
- `#app/analysis` — screening/backtest configuration, run/cancel and results
- `#app/rules` — system rules and local user-rule CRUD
- `#app/journal` — draft/manual transactions and example position/P&L
- `#app/access` — entitlement, devices, revoke and local cache state

Runtime backend/OpenAPI remains the source of truth for implemented calls; the
MVP contract is the target. Successful authentication needs backend and Supabase
configuration. Current screenshot values are illustrative, never live-market claims.

## Interface system

Tailwind v4 is wired through `@tailwindcss/vite`. Project-owned shadcn Base UI
primitives live in `src/components/ui`, with the `@/` alias pointing to `src/`.
The layout, Manrope typography, green/black tokens, flat ledger panels, focus
states, and reduced-motion behavior match the desktop application.

## Authorization contract

Verified against the Go API `openapi.yaml` version 0.9.0 and private-screener
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
execution. It requires `core-0.3.0`, `worker-2`, and
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
