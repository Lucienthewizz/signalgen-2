# Google sign-in — SignalGen

## Status

The application implements Google sign-in with Supabase PKCE. Provider activation
and a real Google account smoke test must be completed separately; passing fixture
tests does not prove those external settings are enabled.

## Flow

1. Login and Register offer **Continue with Google**. Email/password stays available.
2. Browser creates a random verifier in this tab's sessionStorage and SHA-256 challenge.
3. `POST /api/auth/google/start` checks a fixed callback path on an origin already
   present in `SIGNALGEN_CORS_ORIGINS`. Supabase `/settings` must report Google enabled.
4. Browser navigates to Supabase `/auth/v1/authorize`, then Google. Only identity
   scopes (`openid email profile`) are requested; no Gmail/Drive access or offline grant.
5. Google redirects to **Supabase's callback**; Supabase returns a single-use code to
   **the website's callback**. These are two different URLs, configured below.
6. Website removes the code/error query from the address bar, consumes this tab's
   verifier (ten-minute local expiry) and POSTs code + verifier to
   `/api/auth/google/exchange`. No automatic retry of single-use code exchange.
7. Backend exchanges at `/auth/v1/token?grant_type=pkce` using its existing publishable
   key. It discards Google API tokens and returns the existing identity-only login shape.
8. Browser calls the existing app-session creation endpoint. Account status, device
   limits, ownership, role and entitlement remain server-owned. Google login never
   automatically grants a paid plan or operator privileges.

No new library, environment secret, table, migration or WASM change is required.
Auth responses use private/no-store. Session clear removes pending verifier.
Callback navigation needs SPA fallback to `index.html` in production hosting;
Vite development already supports it. Do not log callback query strings or POST bodies.

## Google Cloud fields

Use a dedicated SignalGen Google Cloud project, Google Auth Platform:

| Field | Development value |
|---|---|
| App name | SignalGen |
| Support/developer contact | The account owner's selected email; confirm in the console |
| Audience | External, testing while developing; add the intended test accounts |
| Scopes | openid, userinfo.email, userinfo.profile only |
| OAuth application type | Web application |
| Client name | SignalGen web |
| Authorized JavaScript origins | `http://localhost:5174` and `http://127.0.0.1:5174` |
| Authorized redirect URI | `https://igbccuajdetydwxtwwhu.supabase.co/auth/v1/callback` |

Project ref above was verified against the connected SignalGen Supabase project on
5 November 2026. For another deployment, read its own Google provider callback URL.
Do not replace the Google redirect URI with the Vite URL. Do not reuse another
application's OAuth client or broaden its permissions.

## Supabase dashboard fields

Authentication → Sign In / Providers → Google:

- Enable Google after reviewing configuration.
- Client ID: from the dedicated Google Web application client.
- Client Secret: enter privately in Supabase; never in chat, repository, Vite env or browser bundle.
- Keep nonce checks and email verification protections enabled.

Authentication → URL Configuration:

- Site URL: `http://localhost:5174` for this local deployment.
- Add exact Redirect URLs:
  - `http://localhost:5174/auth/google/callback`
  - `http://127.0.0.1:5174/auth/google/callback`
- Preserve existing signup/recovery URLs; do not overwrite the allowlist.
- For deployment, add explicit HTTPS website origin/callback in Google, Supabase
  and backend CORS allowlist. Do not add a wildcard to bypass a mismatch.

Creating OAuth credentials, entering the new secret and enabling external identity
access require an explicit user review/credential handoff when using browser automation.

## Checks

- `cd backend && go test -race ./...` and `go vet ./...`.
- Validate `backend/openapi.yaml` (API 0.18.0).
- `cd frontend/web && npm test && npm run build`.
- Browser fixture: `node scripts/test-browser.mjs --auth` with the installed Playwright
  CLI wrapper in `SIGNALGEN_TEST_PLAYWRIGHT_CLI`.
- Fixture covers duplicate click/exchange, disabled provider, cancelled/expired and
  unsolicited callback, app-session handoff, mobile/desktop, dark/light.
- Real smoke: user signs in personally, confirms the identity scopes, sees their
  workspace, and checks sign-out plus existing email/password login. Do not submit
  real credentials or claim success from mocked responses.

Sources: [Supabase Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
