# Packaged API with disposable local PostgreSQL

The API-stack phase passes on `frontend/local-api-stack-verification`, based on
`25ea6006daff8ac2a70f2481f4f0e37fa06b9038`. The browser-to-real-API phase needs
validation because a browser runtime with the required isolation is unavailable.
This result does not relabel the earlier API-mocked browser suites.

[Structured evidence](local-api-stack-20261113.json) records the exact image/input
hashes, resource controls and grouped HTTP results. The
[reproduction guide](../backend/LOCAL_API_STACK_VERIFICATION.md) describes the
services and commands.

## What actually ran

The real `/usr/local/bin/signalgen-api` binary ran from
`sha256:cf5e1397b73b4e463b360897f19f5ac0fe02470288b025dd1114a614efa85a50`,
Linux/arm64, UID `10001:10001`. Its source label is
`2c4ad1dfbb6a045b7d5a6968eacf971b6f3b81e2`; the later `25ea600` commit changes
documentation only. Protected application/schema inputs were byte-compared with
`25ea600` before compiling the new helper. No product source was changed.

The disposable PostgreSQL image was
`sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1`.
The isolated Go toolchain was
`sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61`.
The actual API used restricted `signalgen_api` connections, never the bootstrap
administrator. Existing runtime privilege/readiness checks passed. The separate
bootstrap client created only this task's fixture identities, catalog and manual
Pro subscriptions. Owner A was bootstrapped as a disposable operator for that
server-owned activation; owner B was a Pro subscriber. No cloud identity or
existing database was used.

`cmd/schematest` applied 14 current migrations and passed three policy checks on
a fresh database named exactly `signalgen_test`. The market fixture generated
23 histories with alternating rising/falling daily closes and published them
using real `collection.Sync`. API reads used the real `idx_store` provider with
a read-only store bind. The local identity HTTP fixture supplied dummy login and
authoritative HS256 bearer lookup; the actual API's identity bridge and all
application routes/repositories/private scoring remained in use.

## Results

| Check | Observed result |
| --- | --- |
| Offline Go helper build, fixture unit test, vet and gofmt check | Pass |
| Python syntax and parser/isolation preflights | Pass; two preflight tests |
| `/health` and dependency/privilege `/ready` | HTTP 200 |
| Real login and app-session creation | Both dummy owners received identity/app sessions through real API routes |
| Owned custom rule/universe creation | HTTP 201; foreign owner reads returned 404 |
| Historical screening | 23 stocks, three batches, all fixture manifests available; 12 matched stocks and 11 unmatched |
| Found evidence | First matching stock `AAAA.JK` had a BUY signal on synthetic candle `2026-01-20T00:00:00Z`; all 12 first-match examples are retained in structured evidence |
| Real compute grants | 46 grants persisted in PostgreSQL, with returned purpose/dataset/checksum/rule hash binding assertions |
| Feature/private decision boundary | Native portable core produced features; real HTTP private scoring returned entries; truncated feature sequences were rejected with HTTP 422 |
| Outcome handoff | Real backtest decisions fed native `RunSignalStudy` for every matching stock; no browser/WASM claim |
| Frozen context | Rule/date/source metadata checked; editing a rule after context creation caused HTTP 409 `VERSION_MISMATCH` |
| Foreign session/owner | `403 SESSION_REVOKED`, `404 RESOURCE_NOT_FOUND` and `403 GRANT_INVALID` on the relevant actual routes |
| Expiry | `403 GRANT_EXPIRED` and `403 SESSION_EXPIRED`, induced only in owned disposable fixture rows |
| Recovery | Actual `429 STUDY_CAPACITY` for a second active context; `409 STUDY_BUSY` for another batch; release/cancel removed handles, stale reads returned 404 and context recreation succeeded |
| Cleanup | No task stack containers remained; prior images/containers/worktrees were preserved |

The final run executed 240 HTTP assertions. It did not generate or mock private
API decisions. Expected matches come from the synthetic price direction and
EMA9/EMA20 rule; they make no claim about real market behavior. The record retains actual rejection codes; the harness explicitly asserts
session, grant-expiry and rule-change codes.

## Controls and commands

```sh
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/test_local_api_stack.py
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/verify_local_api_stack.py
```

Every Docker call selects `--context orbstack`; all images are pinned and
`--pull=never`. PostgreSQL owns a network-none namespace, shared only by the
exact task containers over loopback. No ports are published. Read-only roots,
source/toolchain/store binds, scratch-only tmpfs writes, empty child env
allowlists, non-root users, CPU/RAM/PID/file/disk/wall limits and dropped
capabilities are enforced. Container log persistence is disabled. No Docker
socket, personal profile, env or credential directory is mounted. The runner
only removes its exact generated container names.

The previous Docker timeout is preserved as a
[historical failed preflight](local-api-stack-blocked-20261113.md). After the
coordinator confirmed recovery without a restart, the runner used explicit local
context and bounded probes. Two harness expectations were corrected during
validation: readiness now probes actual HTTP instead of inspecting stdout logs,
and foreign/expired app sessions expect the documented 403 codes rather than
401. No product behavior or policy was relaxed. The final run passed after
formatting and disabled container logging were included.

The graph initially supplied metadata-match coverage for API composition,
identity, existing Postgres integration and schema runner paths. Partial SQL
stub ranges and excluded migrations were read directly. Later graph calls
failed with `Transport closed`; study/private-scoring/publication/runtime paths
and new scripts were checked directly against current source. No exhaustive
coverage claim follows from the older graph generation.

Docker's official documentation describes the
[none network's loopback-only isolation](https://docs.docker.com/engine/network/drivers/none/),
[shared container network namespaces](https://docs.docker.com/engine/network/) and
[per-container logging drivers](https://docs.docker.com/engine/logging/configure/).
These references were checked through Context7; the controls above were also
exercised by the local runner.

## Still unverified

The available browser tools expose no supported way to join this isolated
Linux loopback namespace with all required write/resource controls, and this
task was not provided an approved cached browser image. No personal browser or host-port fallback was used. A safe
follow-up requires a reviewed existing browser/runtime image sharing only the
private namespace, read-only app/WASM assets and bounded profile/IndexedDB
scratch. That would test desktop/mobile login, screening and backtest against
the real API. The present proof is API plus native client computation only.

Real Supabase identity, live IDX coverage/freshness, Yahoo, ordinary/latest
WebSockets, original production-Dockerfile clean build, Linux timer activation,
premium API specification/cost, staging/devices and full-user-load capacity
remain outside this result. No paid request, image registry push, cloud operation
or deployment occurred. Existing successful product suites and benchmarks were
not rerun because product source is unchanged.
