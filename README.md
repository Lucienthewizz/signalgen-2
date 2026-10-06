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

The latest backend branch checkpoint and remaining MVP gates are tracked in
[docs/backend/BACKEND_PROGRESS.md](docs/backend/BACKEND_PROGRESS.md). The list
below also includes historical UI work; it is not an end-to-end verification
claim for the active web screening flow.

- Go-owned register, login, profile, password recovery, and password update flows backed by Supabase Auth.
- Go app sessions, owner-scoped devices/universes, feature grants, rules,
  protected market-data snapshots, and compute grants.
- Identity refresh and current app-session secret rotation.
- Historical screening WebSocket flow with private server-side decisions,
  permission rechecks and bounded resources.
- Docker-based backend workflow compatible with Docker Desktop and OrbStack.

Historical desktop work remains under `legacy/desktop` and the Python
baseline under `legacy/python`. These are legacy references, not the active
web-only product or evidence that every current PRD feature is complete.

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

Canonical scope and architecture are documented in [docs/PRD.md](./docs/PRD.md) and [docs/PROJECT_CONTEXT.md](./docs/PROJECT_CONTEXT.md).

## Repository structure

```text
signalgen-2/
├── backend/                 Active Go API/core
├── frontend/
│   └── web/                 Active web application
├── legacy/                  Python and Electron comparison source
├── docker-compose.yml       Local backend orchestration
├── docs/                    Product, architecture, experiment, and handoff documents
└── README.md                Repository entry point and local setup
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

### 2. Start the active web frontend

```bash
cd frontend/web
npm install
npm run dev
```

Use the URL printed by Vite and allow that exact origin in the backend CORS
configuration. Frontend setup is documented in `frontend/web/README.md`.

### Optional: inspect the legacy Electron reference

```bash
cd legacy/desktop
npm install
npm run electron:dev
```

For a renderer-only browser preview:

```bash
npm run dev
```

Then open `http://127.0.0.1:5173`.

### 3. Verify the web build

```bash
cd frontend/web
npm run typecheck
npm run build
```

## Development principles

- Treat the backend OpenAPI contract as the source of truth for request and response shapes.
- Keep API and WebSocket base URLs in centralized runtime configuration.
- Never place Supabase secret keys, service-role keys, passwords, or backend environment values in frontend code.
- Handle loading, empty, success, error, offline, and unauthorized states explicitly.
- Preserve legacy references for comparison; do not add new desktop features to the web MVP.
- Keep changes scoped and verify type checking and production builds before review.

## Documentation

- [Legacy comparison guide](./legacy/README.md)
- [Desktop frontend guide](./legacy/desktop/README.md)
- [Documentation index](./docs/README.md)
- [Product requirements](./docs/PRD.md)
- [Frontend MVP PRD](./docs/frontend/FRONTEND_MVP_PRD.md)
- [Backend MVP PRD](./docs/backend/BACKEND_MVP_PRD.md)
- [Target API and worker contract](./docs/backend/MVP_API_CONTRACT.md)
- [Architecture and project context](./docs/PROJECT_CONTEXT.md)
- OpenAPI contract: [`backend/openapi.yaml`](./backend/openapi.yaml)

## License and ownership

This repository is maintained for the SignalGen 2.0 development project. Confirm licensing and distribution requirements with the project owner before publishing packaged builds.
