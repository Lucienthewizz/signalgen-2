# Railway checkpoint and deployment evidence — 19 November 2026

Status: implementation and database setup in progress. **Not a completed cloud
deployment or proof of three automatic scheduler events.** No daily schedule is
activated by this report. See [configuration/rollback](../backend/RAILWAY_DEPLOYMENT.md).

## Verified

- Checkpoint created at `a65206369f469fa607dc8aa38e20320b6ca83569`;
  implementation branch `feature/backend-railway-deploy`.
- Before migration: Supabase database 19,385,491 bytes; active catalog IDX 962,
  XNAS 3,439, XNYS 2,161. These are catalog counts, not downloaded coverage.
- Additive market-archive migration applied to the existing cloud project.
  Six market tables exist. API candle writes and writer profile reads denied.
- Restricted writer login enrolled with a separately generated SCRAM verifier.
  Real writer connection/privilege preflight passed; database 19,704,979 bytes
  at that check. Clear credentials were not printed or committed.
- Writer connection uploaded as GitHub Secret `SIGNALGEN_MARKET_WRITER_URL`.
- Native `railway-runtime` and pinned Redis Docker images built successfully.
- Redis container test: authenticated PONG; unauthenticated NOAUTH; 67,108,864
  byte maximum, allkeys-lru, persistence disabled; no host port published.
- Redis Go integration passed: L2 reuse, TTL, namespace separation and bounded
  outage fallback. Test cache keys used isolated namespaces.
- PostgreSQL fixtures passed with restricted API/writer roles: unchanged rows
  are not duplicated, correction creates one new version, pinned reader retains
  old values, context reuse with different dates rejected, market lock excludes
  overlap, smoke hidden by RLS, 72-hour retention/pruning, and manual events not
  counted as scheduled success.
- Full Go race regression and vet passed during implementation. After code
  changes, relevant suites are rerun before delivery; final results below.
- Workflow action SHAs verified against the official action repositories.
  Actionlint v1.7.12 passed; outer guard boundary tests passed. Railway config
  fields checked against the official JSON schema.

## Awaiting runtime evidence

| Check | Current evidence |
|---|---|
| Railway API/Redis deployment | CLI login has not completed; no cloud URL verified |
| Cloud API health, login, HTTPS/WSS | Not run |
| Three-month IDX/US bootstrap | No complete coverage report yet |
| Database size after bootstrap | Not measured; estimates cannot replace actual size |
| Manual Yahoo collector smoke | Pending |
| Automatic schedule event 1 | No run ID yet |
| Automatic schedule event 2 | No run ID yet |
| Automatic schedule event 3 | No run ID yet |
| Five-minute workflow disabled after test | Not yet armed on the default branch |
| Daily workflow enabled after checks | Must remain disabled |

The Railway browser login expired without callback. The workflow-only PR must
be reviewed/merged to the default branch before scheduled events are possible.
Backend/main merge is not authorized. GitHub scheduling can be delayed.

## Preserved scope

The running local API/provider configuration, frontend port 5174, local
five-year archive, legacy backend and existing IDX scheduler are preserved.
Unrelated dashboard document edits and duplicate frontend files are excluded
from commits. No user data or subscription changes are part of this deployment.

## Final checks and publication

Updated after the final verification and push. Pending runtime checks above
must not be reported as passed merely because source/tests exist.
