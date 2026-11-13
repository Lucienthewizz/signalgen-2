# Local API harness cleanup reliability

Independent review found that a timeout in the first `docker rm` call escaped
the cleanup loop, preventing removal attempts for the remaining owned containers.
This is a test-harness reliability defect; no security violation was demonstrated.
The prior successful API-stack run remains valid.

The fix starts from `4b2173c4199345770d58cbdcf927bfd3f193fada` on
`frontend/local-stack-cleanup-reliability`. Cleanup now attempts every recorded
container in reverse order, with the existing explicit local Docker context and
20-second per-command timeout. Timeouts, command failures and process launch
errors are collected and reported with the affected names. Unresolved cleanup
fails an otherwise successful run; when the stack already failed, its original
exception is preserved and the cleanup failures are reported separately.
Application code, database schema and other worktrees were unchanged.

## Verification

All six tests in `backend/scripts/test_local_api_stack.py` passed. Four new
fault-injection cases cover continuing after timeout, command and launch failures,
preserving the original exception, and bounded exact-name successful cleanup.
Docker removal is mocked in these tests; no real workload is deleted.

Tests ran in the existing Python image
`sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534`
with no network, read-only root/source, UID/GID 65534, dropped capabilities and
no-new-privileges. Limits were one CPU, 128 MiB RAM, 32 PIDs, 8 MiB per file,
16 MiB scratch tmpfs, a 20-second child deadline and 30-second outer timeout.
The child environment contained only PATH, scratch HOME/TMPDIR and
PYTHONDONTWRITEBYTECODE. The command was
`python -B /source/backend/scripts/test_local_api_stack.py`.
The initial test mount used a shallower path incompatible with the existing
repository-root calculation; preserving the expected directory depth resolved
that setup error. No product code changed to accommodate the sandbox.

A separate trusted Docker CLI probe against a freshly generated nonexistent
task name confirmed that `docker rm -f` exits zero for an already-absent resource
on the current engine. The six tests and `git diff --check` pass. The full
240-assertion API stack was not rerun for this cleanup-only change. A genuinely
unresponsive Docker daemon can still prevent deletion; the harness reports that
condition and continues the remaining bounded attempts.
