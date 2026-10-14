# Batched screener computation

The frontend previously created one Go/WASM Worker, compute grant, ticket and
socket for each stock. It now computes the whole dataset in one persistent
Worker, issues one compute grant for the run, and packs complete per-stock
candidate chronologies into bounded batches. Results map back by symbol and
timestamp, not by whichever result happens to be last.

The worker reuses only the public Go engine between jobs. It is disposed after
60 seconds idle or page exit. Cancellation and timeout terminate it immediately;
the next job starts fresh. Concurrent jobs are rejected instead of sharing job
state. Failed/canceled jobs cannot leave stale handlers or timers attached.

## Current backend limits (unchanged)

The existing socket handler consumes one ticket, reads one message, returns one
result and closes. `MaxCandidates` is 1000 and the message limit is 256 KiB.
Packing uses the ticket's candidate bound and 240,000 bytes of candidate JSON,
leaving room for the envelope. If the whole run fits, it uses one ticket/socket.
Larger runs reuse the same grant but obtain fresh tickets and score sequential
bounded batches. A stock's chronology is never split across messages, because
that would reset cooldown and change decisions. Oversized individual stocks fail
clearly rather than silently trimming data.

This is not unlimited single-socket streaming; supporting that would require a
backend contract change, deliberately excluded by the user's instruction.
Permissions, dataset ownership and private scoring remain server controlled.

## Verification and measurements

Contract harness: three stocks / 120 candidates now require one Worker, one grant,
one ticket and one socket (previous architecture: three of each). A second run
reuses the Worker. Tests also cover bounded fallback, cancellation, pre-abort,
timeout, busy rejection, malformed/mismatched decisions and clean early close.

Real Go/WASM browser check: three synthetic stocks × 100 candles produced 243
candidates, identical byte-for-byte feature output in the legacy per-stock mode,
the batch mode and a second warm batch. Worker counts were 3 → 1, then 0 new
workers on the warm run. A single local headless Chromium sample measured
63.9 ms / 45.2 ms / 4.8 ms respectively. Assets may already be HTTP-cached and
the execution order favors warm reuse. These are illustrative local measurements,
not p50/p95, real-device memory profiling, production throughput or full provider
latency benchmarks. Repeat with `tests/browser/screener-engine.cli.js`.

Current-run feature time and candidate/socket counts are visible under technical
data details. Unit/contract tests use mock sockets. No real-account authenticated
scoring mutation was performed; backend, database and `.env` are unchanged.
