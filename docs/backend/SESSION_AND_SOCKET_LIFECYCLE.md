# App session and screening connection lifecycle

## Separate credentials

| Credential | Renewal | Effect |
| --- | --- | --- |
| Supabase access/refresh pair | POST /api/auth/refresh | Identity only |
| X-App-Session secret | POST /api/v1/sessions/{id}/refresh | Replace current session hash |
| Compute grant | Prepare valid context and create a new grant | Binds rule/dataset/version/session |
| WebSocket ticket | Request a new ticket | One upgrade only; short expiry |

App-session rotation requires a valid bearer and current app-session token.
The path ID must be the current session. The body is empty or `{}`; expiry,
owner and installation cannot be edited. On 200, atomically replace the local
`X-App-Session` value. The response has the same shape as session creation.

The Postgres update checks owner, ID, old token hash, revocation and database
clock expiry in a single compare-and-swap. Only the replacement SHA-256 hash
is stored. Concurrent requests using the same old secret have one winner.
Session ID, original expiry, device-switch cooldown and existing grant bindings
remain unchanged. Rotation is not an alternative to explicit revocation.
The legacy SQLite reference has no rotation implementation.

There is no grace period or automatic replay recovery. Serialize across tabs.
If the response is lost after the commit, the old secret is invalid: do not
blindly retry a mutation. Recover through explicit session setup with the valid
Supabase identity, respecting the normal device limit/cooldown.

## WebSocket checks and limits

A consumed ticket is verified against the session, active account, entitlement,
compute grant, dataset and private rule before upgrade. After the client sends
its single batch, these states are checked again immediately before scoring.
Revoked/expired sessions, suspended accounts, revoked entitlements, expired
grants, changed dataset bindings and missing snapshots do not produce results.
Changed/missing custom rules are re-read rather than evaluated from an old copy.

This is not a transaction across all stores. A revocation concurrent with the
calculation does not promise cancellation of already-authorized in-flight work.
Client features remain untrusted and the endpoint is not an attestation service.

Default process-local resource bounds:

- 32 concurrent authenticated sockets, maximum 2 for one ticket owner.
- One batch per socket, 10-second lifetime, 256 KiB message limit.
- 1,024 pending tickets total, maximum 16 per owner, 30-second ticket expiry.

Ticket limits never evict valid tickets. Expiry or consumption releases space.
Socket slots are released on completion, protocol failure, disconnect, failed
upgrade or shutdown. Capacity denial is 429 with Retry-After: 1; it is not a
promise that capacity will be available one second later. The upgrade ticket
has already been consumed, so a retry needs a new ticket.

Configure socket bounds with `SIGNALGEN_MAX_SCREENER_CONNECTIONS` and
`SIGNALGEN_MAX_SCREENER_CONNECTIONS_PER_USER`. The API refuses inconsistent
limits at startup. Multi-replica capacity and shared ticket storage remain
deployment design work; these limits are not production capacity measurements.

## Shutdown

SIGTERM/SIGINT cancels the process context used by hijacked WebSockets. Ordinary
HTTP requests drain for up to 10 seconds, then remaining connections are closed.
The main process waits for the drain to finish before closing the Postgres pool.
Clients must reconnect and prepare fresh process-local tickets/snapshots after
restart. No token, ticket, private rule or credential is logged by these changes.

## Evidence

Tests cover a real Postgres rotation race (16 attempts, one winner), cross-owner
denial, unchanged expiry, old-token invalidation, persisted hash, and rejection
of expired/revoked sessions. Real HTTP/WebSocket transport tests simulate
authorization changes after upgrade plus shutdown cancellation; provider/Auth
identity fixtures are deterministic, not live cloud authentication.

OpenAPI, the WebSocket JSON schema and Postman collection describe the new
contracts. No Supabase migration or frontend change is required for this slice.

Verification on 2026-10-05: full `go test -race ./...` with the isolated
Postgres integration enabled and `go vet ./...` passed. Five migrations and
two SQL policy checks passed on the empty test database. The Go 1.26 Docker
runtime built, returned 200 from health/readiness, and exited with code 0 on
SIGTERM. Temporary API/database test containers were cleaned up afterward.
