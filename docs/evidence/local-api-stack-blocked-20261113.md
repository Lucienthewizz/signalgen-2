# Local API stack: Docker control-plane blocker

The worktree is on the new `frontend/local-api-stack-verification` branch at
`25ea6006daff8ac2a70f2481f4f0e37fa06b9038`. Fetch verified that the integration
branch still has that exact tip. The preceding feature/runtime task remains
complete; this new actual-API-stack task is not verified.

Before any target build or stack container launch, the runner's first pinned
image inspection failed:

```text
subprocess.TimeoutExpired: Command '['docker', 'image', 'inspect',
'sha256:cf5e1397b73b4e463b360897f19f5ac0fe02470288b025dd1114a614efa85a50']'
timed out after 60 seconds
```

An independent five-second `docker version --format '{{.Server.Version}}'`
probe also timed out. An own read-only `docker ps` probe hung and its exact CLI
process was terminated; no daemon restart or container cleanup was attempted.
No target container was launched by this task. No database was initialized and
no API/business route was tested.

Draft files `backend/scripts/localstack/main.go` and
`backend/scripts/verify_local_api_stack.py` remain uncommitted. The Python source
passes AST parsing; the Go helper has not been compiled or checked. They are
unfinished work, not a reproducible passing verification. Browser isolation is
also unverified. Existing API-mocked browser evidence is unchanged.

The safe next step is for the coordinator/operator to restore Docker server
responsiveness while preserving other workers' resources, then resume the
bounded offline runner and resolve any compile/runtime failures. The runner
must pass schema checks and actual packaged-API business requests before any
success claim or Git delivery. A browser requires the same execution controls;
no host-profile fallback is authorized.
