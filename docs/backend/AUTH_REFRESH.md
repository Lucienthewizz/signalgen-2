# Supabase identity refresh — backend contract

## What changed

The Go auth gateway now preserves Supabase's refresh token on login and on
signup when Supabase immediately creates a session. Signup requiring email
confirmation still returns null access/refresh tokens. No credentials are
stored in SignalGen's database by this operation.

`POST /api/auth/refresh` accepts only:

```json
{"refresh_token":"<current refresh token>"}
```

It returns the same identity-session shape as login:

```json
{
  "access_token":"<new access token>",
  "refresh_token":"<new refresh token>",
  "token_type":"bearer",
  "expires_in":3600,
  "user":{"id":"<verified provider user id>","email":"user@example.test","full_name":null}
}
```

The tokens above are placeholders, not real credentials. Responses and errors
use `Cache-Control: private, no-store`. A publishable key is sufficient for
the Supabase token exchange; no service-role key or migration is needed.

## Identity is not app authorization

Supabase rotates the identity token pair. SignalGen does not mint refresh tokens,
accept client role claims, renew app-session expiry, or grant paid access here.
Business endpoints still verify identity, owner-bound `X-App-Session`, account
status, and required entitlement. A revoked/expired app session remains invalid
even after successful identity refresh. Its lifecycle is separate from the
Supabase session.

The endpoint must not require an unexpired access bearer: renewal is needed
precisely when that token expires. Public-auth rate limiting therefore uses the
direct peer IP, not raw tokens. Trusted-proxy configuration remains deployment
work; the API does not trust arbitrary forwarded headers.

## Frontend handoff (not implemented in this backend change)

1. Save both returned identity tokens together on login. Existing clients that
   save only an access token must login again to obtain a refresh token.
2. Track `expires_in` and request refresh before access expiry. Use a single
   in-flight refresh operation and coordinate across tabs. Do not run both SDK
   auto-refresh and gateway refresh independently against the same session.
3. On 200, replace both tokens together before retrying dependent requests.
   Supabase may return an existing active pair within its reuse allowance;
   do not insist that every token string differs from its previous value.
4. On 401 (`AUTH_INVALID`), clear identity state and ask for login.
   On 429/503, keep state and show a temporary error; do not blindly retry
   token exchanges or reinterpret a provider outage as invalid credentials.
5. Keep the existing app-session token only while it remains valid. Refresh
   does not reset the device/session limits, revive grants, or renew socket
   tickets. Do not retry mutations indiscriminately after refresh.
6. Never include tokens in URLs, analytics, logs, committed files, screenshots,
   or exported Postman environments. Production requires HTTPS.

## Verification and limits

Provider tests use an isolated HTTP Supabase adapter and cover rotated pairs,
invalid/revoked tokens, rate limits, outages, malformed/oversized/incomplete
responses, cancellation, and no automatic retry. API tests cover JSON validation,
no expired-bearer requirement, no-store, public rate limiting, and retained
app-session access requirements. The Postman auth folder includes refresh and
updates both environment variables on success.

Cloud login/refresh and browser automatic renewal are not verified by these
tests; they use deterministic local identity responses and do not create real
accounts or send recovery emails. Auth refresh alone does not establish that
all P1 authentication or production deployment work is complete.

Local verification on 2026-10-05 passed the full `go test -race ./...` suite,
`go vet ./...`, and the Go 1.26 Docker API runtime build. The optional real
Postgres integration test was not rerun for this identity-only change; it had
passed in the preceding screening implementation. OpenAPI and both Postman JSON
files passed syntax validation. No cloud schema or frontend files were changed.

Reference: [Supabase sessions and refresh-token reuse detection](https://supabase.com/docs/guides/auth/sessions).
