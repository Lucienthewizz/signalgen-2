# SignalGen Desktop

The SignalGen desktop client is the primary product surface for stock screening, rule construction, backtesting, and realtime signal monitoring. It is implemented as a secure Electron shell around a React and TypeScript renderer.

## Technology

- Electron 33
- React 18
- TypeScript 5
- Vite 6
- Socket.IO client
- Lucide icons

## Implemented foundation

### Application shell

- Sandboxed Electron renderer with `contextIsolation` enabled and Node.js integration disabled.
- Restricted preload bridge for future native capabilities.
- Responsive sidebar navigation and desktop toolbar.
- Production renderer loading from the local `dist/` directory.

### Authentication

- Login and registration through the FastAPI authentication API.
- Supabase access-token storage for the active desktop session.
- Session restoration through `/api/auth/me`.
- Automatic local-session cleanup when the backend returns `401`.
- Clear backend-offline, validation, success, and loading states.

### Dashboard

- Backend connectivity and operational status.
- Active-rule, watchlist, and daily-signal summaries.
- Market-watch table with readable signal states.
- Signal-distribution overview and direct navigation to realtime monitoring.
- A deliberate Rule → Backtest → Realtime workflow.
- Explicit labels for illustrative market data that is not yet connected to a live feed.

## Visual system

The interface uses an operational, data-first design language inspired by the structure and restraint of modern Indonesian market terminals:

- tinted near-black surfaces for extended desktop use;
- warm red reserved for primary actions and important state changes;
- high-contrast typography with a clear reading order;
- tabular numerals and real chart geometry for market information;
- borders and spacing instead of excessive nested cards;
- purposeful state motion with reduced-motion support;
- visible keyboard focus, themed selection, and consistent scrollbars.

The visual direction may use external products as references, but SignalGen retains its own identity, content, interaction model, and assets.

## Directory map

```text
frontend/desktop/
├── electron/
│   ├── main.cjs             Electron main process
│   └── preload.cjs          Restricted renderer bridge
├── public/                  Static public assets
├── renderer/                Legacy renderer retained during migration
├── src/
│   ├── api/client.ts        Centralized backend client and session handling
│   ├── App.tsx              Authentication, shell, routing, and dashboard
│   ├── styles.css           Application design system and responsive layout
│   ├── types.ts             Shared renderer types
│   └── main.tsx             React entry point
├── package.json
└── vite.config.ts
```

## Local development

### Requirements

- Node.js 20 or newer
- npm
- SignalGen backend running on port `3456`
- Socket.IO service available on port `8765`

Start the backend from the repository root:

```bash
docker compose up --build -d
```

Install desktop dependencies:

```bash
cd frontend/desktop
npm install
```

Run Vite and Electron together:

```bash
npm run electron:dev
```

Run only the renderer in a browser:

```bash
npm run dev
```

The browser preview is available at `http://127.0.0.1:5173`.

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite renderer development server |
| `npm run electron:dev` | Start Vite and Electron with hot reload |
| `npm run typecheck` | Validate the TypeScript project |
| `npm run build` | Create a production renderer build |
| `npm run electron` | Start Electron using the existing production build |

## Development endpoints

Vite proxies requests so the renderer can use relative URLs in development:

| Route | Target |
| --- | --- |
| `/api` | `http://127.0.0.1:3456` |
| `/socket.io` | `http://127.0.0.1:8765` |

`http://127.0.0.1:8765/` is not a web page. A `Not Found` response at that root does not indicate that Socket.IO is unavailable.

## Security boundaries

- Do not expose Node.js APIs directly to the renderer.
- Add native capabilities through narrow, validated preload methods.
- Do not commit backend `.env` values, Supabase secrets, service-role keys, passwords, or session tokens.
- Keep business logic and authorization enforcement in FastAPI.
- Treat hidden frontend controls as presentation only; backend ownership checks remain mandatory.

## Migration status

The legacy renderer remains in `renderer/` until the React/Electron application reaches feature parity. New functionality should be delivered as small vertical slices against the current OpenAPI contract rather than by inventing frontend-only endpoints.

See the repository [PRD](../../PRD.md) and [project context](../../PROJECT_CONTEXT.md) before changing product scope or architecture.
