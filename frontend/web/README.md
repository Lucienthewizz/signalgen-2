# Signalgen Web

React + TypeScript + Vite web application. It currently contains public/account
work and will become the primary analysis surface under `../FRONTEND_MVP_PRD.md`.
FastAPI is the current legacy backend; the revised target is the versioned Go API
and Go/WASM worker defined in `../../backend/MVP_API_CONTRACT.md`.

```sh
npm ci
npm run dev
npm run build
npm test
```

Local preview: http://127.0.0.1:5174. Development proxies `/api` to the backend at port 3456. Production uses same-origin `/api`, or configure `VITE_API_ORIGIN` at build time.

Includes the supplied Signalgen logo, a responsive workspace shell aligned to
the desktop application, login/register/current-user flows, password recovery,
and local-session cleanup on 401. The web-only UX preview covers the MVP analysis,
rule management, explainable results, journal, entitlement, session/device and
cache-clear surfaces. The analysis, rules, journal, and access surfaces use local
static state that persists across hash-route changes, resets on reload, and never
represents live-market data.

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

Verified against GitHub `feature/backend-authorization` at `9cf2e1fc7de63dcb659c394f6644cb9e616c1d29`:

- `POST /api/auth/login`: JSON `{ email, password }`, returns token and public user fields.
- `POST /api/auth/register`: JSON `{ full_name, email, password }`, supports a nullable token and email confirmation.
- `GET /api/auth/me`: bearer access token, returns public profile fields.

The remote authorization branch does **not** currently expose password reset
routes. This working branch contains the compatible reset-request/reset endpoints
in the legacy FastAPI app; they must be ported into the extracted authorization
router when those backend branches are consolidated.

The web client does not import backend secrets or merge backend code. Run that backend branch separately on port 3456 for live development. For another API host, set `VITE_API_ORIGIN` at build time (for example `https://api.example.com`); that backend must allow the website's origin through CORS.

`npm test` verifies request bodies, recovery tokens, bearer headers,
confirmation responses, validation failures, and session handling using a mocked
transport. Real authentication and recovery require a configured running
Supabase-backed backend. Desktop source files are not changed by this web
revision.
