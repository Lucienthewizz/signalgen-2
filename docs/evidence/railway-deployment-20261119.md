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
- Real manual collector preflight passed on commit
  `a0d63c6fe84610e31f37de77fdae013762cd50aa`: IDX run
  `17c1b30a-e610-43af-a932-be08211c2651` and US run
  `4771feac-a19a-4c60-a00c-6dc088b91c0d`, three successful tickers and 195
  inserted candles each. Total 390 smoke candles; no production publication.
  [Full non-secret report](market-manual-preflight-20261119.json).
- The initial manual attempt caught an empty Yahoo default URL before any
  candle collection. The constructor now supplies/validates an HTTP(S) origin
  before consuming a smoke event. A regression test covers this startup path.
- [Workflow-only PR #2](https://github.com/Lucienthewizz/signalgen-2/pull/2)
  contains four scheduler/guard files and no backend merge. Both activation
  variables are explicitly false; repository Actions are enabled.

## Awaiting runtime evidence

| Check | Current evidence |
|---|---|
| Railway API/Redis deployment | CLI login has not completed; no cloud URL verified |
| Cloud API health, login, HTTPS/WSS | Not run |
| Three-month IDX/US bootstrap | No complete coverage report yet |
| Database size after bootstrap | Not measured; estimates cannot replace actual size |
| Manual Yahoo collector smoke | Passed, six real instruments, 390 candles; does not count as automatic proof |
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

- All 17 migrations plus three schema/policy scripts passed from a fresh
  PostgreSQL 17 database with password authentication. Restricted-role archive
  race tests passed, including three-success/six-failure/one-hour boundaries.
  These scheduled-event fixtures are not live GitHub scheduler proof.
- Full Go race regression and vet passed on the delivery source; contract
  suites are included. Targeted real Redis integration also passed.
- Final native API image passed `/health`, `/ready` and Docker's own healthcheck
  with `PORT=18081` instead of 8080. Both allowed 5174 origins returned matching
  CORS headers; localhost:5175 was rejected with 403. This is a local container
  using the cloud database, not Railway HTTPS/WSS evidence.
- Initial GitHub Backend CI reached the archive test and exposed a fixture
  authentication mismatch (local trust versus CI SCRAM). Fixtures now set
  their own isolated role password rather than inheriting the admin password;
  the equivalent password-authenticated local test passed. Follow-up CI status
  must be checked before calling the remote pipeline green.
- Feature and checkpoint branches pushed and SHA verified. Workflow-only PR
  remains open and unmerged. No main merge or automatic schedule activation.

Pending runtime checks above must not be reported as passed merely because
source/tests exist.
