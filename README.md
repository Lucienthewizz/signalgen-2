# SignalGen 2.0

SignalGen 2.0 is moving to a web-first stock-analysis workspace for the Indonesian market. The revised MVP uses React + TypeScript + Vite, a portable Go core compiled to WebAssembly for client-side historical screening/backtesting, and a Go API target for identity-bound access, data delivery, rules, sessions, entitlements, and the private journal. Electron and Python/FastAPI remain legacy references during incremental migration.

> SignalGen is an analysis tool. A BUY, WATCH, HOLD, or SELL state indicates that configured rule conditions were met; it is not a guarantee of price movement or personalized investment advice.

## Product surfaces

| Surface | Responsibility | Stack |
| --- | --- | --- |
| Web | Primary analysis workspace plus public/account surfaces | React, TypeScript, Vite, Go/WASM Web Worker |
| Active API | Auth/session verification, authorization, feature grants, rules, protected datasets, compute grants, audit | Go, Gin, pgxpool, Supabase Auth/Postgres |
| Legacy desktop | Reference/rollback UI; installer is not an MVP deliverable | Electron, React, TypeScript, Vite |
| Legacy backend | Baseline/bridge while portable core and target API are verified | Python, FastAPI, Socket.IO, SQLite |

The target keeps one API boundary. Historical computation moves to the browser worker; credentials, feature decisions, ownership, and journal authority remain on the server. Go/WASM is not absolute code protection.

## Current implementation

- Go-owned register, login, profile, password recovery, and password update flows backed by Supabase Auth.
- Go app sessions, owner-scoped devices, feature grants, rules, protected fixture data, and compute grants.
- Secure Electron shell with context isolation, sandboxing, and a restricted preload bridge.
- Local session restoration with automatic handling for invalid or expired tokens.
- Responsive desktop workspace with navigation for rules, watchlists, screening, backtesting, realtime signals, and settings.
- Market-oriented dashboard with backend health, active-rule, watchlist, and signal summaries.
- Centralized API client and Vite development proxies for REST and Socket.IO traffic.
- Docker-based backend workflow compatible with Docker Desktop and OrbStack.

The Python/FastAPI service remains available only through the explicit Docker
`legacy` profile for baseline comparison and rollback. It is not the active web
authentication path.

## Target architecture

```text
                      User
                        │
                        ▼
                 frontend/web/
          React UI + Go/WASM worker
                  │ REST/HTTPS
                  ▼
              Active Go API
       auth/access/data/rules/journal
              │             │
              ▼             ▼
       Supabase Auth   Supabase Postgres

 Legacy: Electron + Python/FastAPI kept for baseline and rollback
```

Canonical scope and architecture are documented in [PRD.md](./PRD.md) and [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

## Repository structure

```text
signalgen-2/
├── backend/                 Go API/core plus legacy Python reference
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

- REST/API status: `http://127.0.0.1:8080/api`
- Health: `http://127.0.0.1:8080/health`
- Machine-readable contract: `backend/openapi.yaml`

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
- OpenAPI contract: [`backend/openapi.yaml`](./backend/openapi.yaml)

## License and ownership

This repository is maintained for the SignalGen 2.0 development project. Confirm licensing and distribution requirements with the project owner before publishing packaged builds.
