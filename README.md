# SignalGen 2.0

SignalGen 2.0 is moving to a web-first stock-analysis workspace for the Indonesian market. The revised MVP uses React + TypeScript + Vite, a portable Go core compiled to WebAssembly for client-side historical screening/backtesting, and a Go API target for identity-bound access, data delivery, rules, sessions, entitlements, and the private journal. Electron and Python/FastAPI remain legacy references during incremental migration.

> SignalGen is an analysis tool. A BUY, WATCH, HOLD, or SELL state indicates that configured rule conditions were met; it is not a guarantee of price movement or personalized investment advice.

## Product surfaces

| Surface | Responsibility | Stack |
| --- | --- | --- |
| Web | Primary analysis workspace plus public/account surfaces | React, TypeScript, Vite, Go/WASM Web Worker |
| Target API | Auth/session verification, authorization, feature grants, rules, historical data, journal/portfolio, audit | Go, SQLite, Supabase Auth |
| Legacy desktop | Reference/rollback UI; installer is not an MVP deliverable | Electron, React, TypeScript, Vite |
| Legacy backend | Baseline/bridge while portable core and target API are verified | Python, FastAPI, Socket.IO, SQLite |

The target keeps one API boundary. Historical computation moves to the browser worker; credentials, feature decisions, ownership, and journal authority remain on the server. Go/WASM is not absolute code protection.

## Current implementation (legacy/baseline, not revised-MVP completion)

- Secure Electron shell with context isolation, sandboxing, and a restricted preload bridge.
- Login and registration flows backed by the FastAPI authentication endpoints.
- Local session restoration with automatic handling for invalid or expired tokens.
- Responsive desktop workspace with navigation for rules, watchlists, screening, backtesting, realtime signals, and settings.
- Market-oriented dashboard with backend health, active-rule, watchlist, and signal summaries.
- Centralized API client and Vite development proxies for REST and Socket.IO traffic.
- Docker-based backend workflow compatible with Docker Desktop and OrbStack.

The dashboard currently contains explicitly labeled interface data while feature screens are migrated incrementally. This does not prove the target Go API, WASM core, entitlement/device controls, or journal are complete.

## Target architecture

```text
                      User
                        │
                        ▼
                 frontend/web/
          React UI + Go/WASM worker
                  │ REST/HTTPS
                  ▼
              Go API target
       auth/access/data/rules/journal
              │             │
              ▼             ▼
       Supabase Auth       SQLite

 Legacy: Electron + Python/FastAPI kept for baseline and rollback
```

Canonical scope and architecture are documented in [PRD.md](./PRD.md) and [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

## Repository structure

```text
signalgen-2/
├── backend/                 FastAPI application and analysis engines
├── frontend/
│   ├── desktop/             Electron desktop application
│   └── web/                 Public and account web application
├── docker-compose.yml       Local backend orchestration
├── PRD.md                   Product requirements and acceptance criteria
└── PROJECT_CONTEXT.md       Canonical architecture and engineering boundaries
```

## Quick start

### Requirements

- Docker Desktop or OrbStack with Docker compatibility
- Node.js 20 or newer
- npm
- A configured `backend/.env` based on the project environment template

### 1. Start the backend

From the repository root:

```bash
docker compose up --build -d
docker compose ps
```

The backend exposes:

- REST API: `http://127.0.0.1:3456/api`
- OpenAPI documentation: `http://127.0.0.1:3456/docs`
- Socket.IO transport: `http://127.0.0.1:8765/socket.io`

Port `8765` is a realtime transport endpoint, not a website. Opening its root URL directly may return `Not Found`.

### 2. Start the current legacy Electron application

```bash
cd frontend/desktop
npm install
npm run electron:dev
```

For a renderer-only browser preview:

```bash
npm run dev
```

Then open `http://127.0.0.1:5173`.

### 3. Verify a production build

```bash
cd frontend/desktop
npm run typecheck
npm run build
```

## Development principles

- Treat the backend OpenAPI contract as the source of truth for request and response shapes.
- Keep API and Socket.IO base URLs in centralized runtime configuration.
- Never place Supabase secret keys, service-role keys, passwords, or backend environment values in frontend code.
- Handle loading, empty, success, error, offline, and unauthorized states explicitly.
- Preserve the legacy renderer until the Electron replacement reaches feature parity.
- Keep changes scoped and verify type checking and production builds before review.

## Documentation

- [Desktop frontend guide](./frontend/desktop/README.md)
- [Product requirements](./PRD.md)
- [Frontend MVP PRD](./frontend/FRONTEND_MVP_PRD.md)
- [Backend MVP PRD](./backend/BACKEND_MVP_PRD.md)
- [Target API and worker contract](./backend/MVP_API_CONTRACT.md)
- [Architecture and project context](./PROJECT_CONTEXT.md)
- OpenAPI after startup: `http://127.0.0.1:3456/docs`

## License and ownership

This repository is maintained for the SignalGen 2.0 development project. Confirm licensing and distribution requirements with the project owner before publishing packaged builds.
