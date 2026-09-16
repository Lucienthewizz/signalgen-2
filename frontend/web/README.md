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
and local-session cleanup on 401. The overview content is explicitly presented
as interface demonstration, not live-market data.

Runtime backend/OpenAPI remains the source of truth for implemented calls; the
MVP contract is the target. Successful authentication needs backend and Supabase
configuration. Current screenshot values are illustrative, never live-market claims.

## Interface system

Tailwind v4 is wired through `@tailwindcss/vite`. Project-owned shadcn Base UI
primitives live in `src/components/ui`, with the `@/` alias pointing to `src/`.
The layout, Manrope typography, green/black tokens, flat ledger panels, focus
states, and reduced-motion behavior match the desktop application.

## Authorization contract

Verified against GitHub `feature/backend-authorization` at `7ea4f91b70296fb834edd81039c6663e221779b7`:

- `POST /api/auth/login`: JSON `{ email, password }`, returns token and public user fields.
- `POST /api/auth/register`: JSON `{ full_name, email, password }`, supports a nullable token and email confirmation.
- `GET /api/auth/me`: bearer access token, returns public profile fields.
- `POST /api/auth/password/reset-request`: sends a neutral recovery response.
- `POST /api/auth/password/reset`: consumes recovery tokens and updates the password.

The web client does not import backend secrets or merge backend code. Run that backend branch separately on port 3456 for live development. For another API host, set `VITE_API_ORIGIN` at build time (for example `https://api.example.com`); that backend must allow the website's origin through CORS.

`npm test` verifies request bodies, recovery tokens, bearer headers,
confirmation responses, validation failures, and session handling using a mocked
transport. Real authentication and recovery require a configured running
Supabase-backed backend. Desktop source files are not changed by this web
revision.
