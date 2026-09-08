# Frontend Agent Instructions

These instructions apply to everything inside `frontend/`.

1. Read `../PROJECT_CONTEXT.md`, `../PRD.md`, and the README of the target
   application before changing frontend code. Treat the context and PRD as the
   canonical architecture and product scope.
2. Keep exactly two frontend applications: `web/` and `desktop/`. Do not create
   a separate backend inside either application; both consume the FastAPI backend
   in `../backend/`.
3. Treat FastAPI OpenAPI at `http://127.0.0.1:3456/docs` and the current backend
   implementation as the API source of truth. Do not invent endpoints silently.
4. Keep API base URLs and Socket.IO URLs in centralized runtime configuration.
   Do not scatter hardcoded URLs through components.
5. Never expose or commit backend `.env` values, Supabase secrets, service-role
   keys, passwords, access tokens, refresh tokens, or runtime databases.
6. Route HTTP calls through a shared API client for each selected toolchain.
   Authenticated requests use `Authorization: Bearer <access_token>`.
7. Handle loading, empty, validation, error, and unauthorized states. A `401`
   must clear the invalid local session and return the user to login.
8. Do not assume multi-user authorization is complete merely because login is
   available. Confirm endpoint protection with the backend developer.
9. Preserve the legacy renderer until the replacement reaches feature parity.
   Prefer incremental vertical slices over a full rewrite in one change.
10. Run the relevant formatter, lint, tests, and build before handing off work.
    Document any unavailable verification explicitly.
11. Keep commits and pull requests small and scoped to one feature. Call out API
    contract changes clearly for backend review.
