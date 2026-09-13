# SignalGen Web

Public product website and account portal for SignalGen 2.0. The web application shares the FastAPI and Supabase Auth identity layer used by the Electron desktop client, so an account created here can be used to sign in on desktop.

## Current scope

- Responsive product landing page for the SignalGen workflow.
- Backend connectivity status.
- Registration with name, email, password, and confirmation.
- Login, session restoration, unauthorized-session cleanup, and logout.
- Account page explaining desktop access and current product status.
- Honest placeholders for commercial capabilities whose backend contracts are not final.

Pricing, checkout, subscription entitlement, password recovery, and production desktop downloads are intentionally not simulated. They remain pending until their backend contracts and product configuration are approved.

## Technology

- React 18
- TypeScript 5
- Vite 6
- Lucide icons
- Self-hosted variable fonts through Fontsource
- CSS-native motion with a reduced-motion alternative

## Development

Requirements:

- Node.js 20 or newer
- npm
- SignalGen backend running on `http://127.0.0.1:3456`

From the repository root, start the backend:

```bash
docker compose up --build -d
```

Then start the web application:

```bash
cd frontend/web
npm install
npm run dev
```

The local website is available at `http://127.0.0.1:5174`.

## API configuration

During development, Vite proxies `/api` to the backend on port `3456`. In deployment, set `VITE_API_BASE_URL` when the API is hosted on a different origin. Keep this value public; never place Supabase secrets, service-role keys, passwords, or tokens in a frontend environment variable.

Authentication uses:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/register` | Create a Supabase-backed SignalGen account |
| `POST /api/auth/login` | Create a session and return an access token |
| `GET /api/auth/me` | Restore and validate the active session |

The browser stores only the current access token. A `401` response clears that token and returns the user to authentication.

## Verification

```bash
npm run typecheck
npm run build
```

See the repository [PRD](../../PRD.md) and [project context](../../PROJECT_CONTEXT.md) for the canonical product and architecture constraints.
