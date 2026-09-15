# Signalgen Web

React + TypeScript + Vite landing and account portal, sharing the existing FastAPI backend with Electron Desktop.

```sh
npm ci
npm run dev
npm run build
npm test
```

Local preview: http://127.0.0.1:5174. Development proxies `/api` to the backend at port 3456. Production uses same-origin `/api`, or configure `VITE_API_ORIGIN` at build time.

Includes the supplied Signalgen logo and an actual desktop overview preview screenshot, sentence-case UI, navigation skeletons, image loading/error states, login/register/current-user, and local-session cleanup on 401. Desktop release, pricing, payment, and entitlement availability are explicitly pending backend/product decisions. No invented release or admin endpoints are called.

Backend API remains the source of truth. Successful authentication needs the backend and Supabase configuration. Current screenshot uses illustrative market values.

## Website UI

Tailwind v4 is wired through `@tailwindcss/vite`. The official shadcn Base UI primitives live in `src/components/ui`, with the `@/` alias pointing to `src/`. Theme tokens and the restrained white gradient live in `src/styles.css`.

The supplied Hyperiux Vault interactive-list component is adapted for Signalgen feature previews, with typed refs, keyboard and touch selection, reduced-motion support, and no idle pointer-follow loop. Its previews are screenshots captured from the actual desktop, including unfinished feature screens; no fabricated product illustrations. Attribution is retained in the component.

The landing entrance animates only the opening copy and desktop preview. FAQ uses the official shadcn Carousel and Card. Testimonials are clearly marked as temporary fictional examples and must be replaced with approved real reviews before production marketing.

## Authorization contract

Verified against GitHub `feature/backend-authorization` at `7ea4f91b70296fb834edd81039c6663e221779b7`:

- `POST /api/auth/login`: JSON `{ email, password }`, returns token and public user fields.
- `POST /api/auth/register`: JSON `{ full_name, email, password }`, supports a nullable token and email confirmation.
- `GET /api/auth/me`: bearer access token, returns public profile fields.

The web client does not import backend secrets or merge backend code. Run that backend branch separately on port 3456 for live development. For another API host, set `VITE_API_ORIGIN` at build time (for example `https://api.example.com`); that backend must allow the website's origin through CORS.

`npm test` verifies request bodies, token headers, confirmation responses, validation failures, and session handling using a mocked transport. Real successful sign-in requires a configured running Supabase-backed backend.

Magnetic Liquid Button from the supplied prompt is integrated into both account CTAs. Springs, tilt, white spotlight, liquid border and click ripples follow the green/black/white Signalgen palette. Reduced motion and touch do not use magnetic movement. FAQ supports arrows, keyboard and swipe; temporary testimonials include stars, quote icons and workflow context. Desktop source files are not changed by this website revision.
