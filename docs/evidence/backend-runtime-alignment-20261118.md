# Local backend runtime alignment — 18 November 2026

The frontend integration had updated source without replacing the running API
image. The API still used source `15c27e18e9d326529516f1b33884220da8e574aa`.
Both `GET /api/v1/screener/scans` and `GET /api/v1/backtests/studies` returned
405, including through the Vite proxy on port 5174. The new frontend requires
these lookups before enabling a screening or backtest run. A healthy `/health`
response therefore did not establish frontend/API compatibility.

The API was rebuilt offline from `aa4ce56b2459beed02e58d7a491223332834de1e`
using the existing bounded local-runtime builder. Its packaged-binary identity,
collector smoke test, non-root identity, and read-only filesystem checks passed.
The replacement image is
`sha256:151f75156d40ee320574efaf73db34b1760043f50fcf61be1fae1079caf88f3d`.

Only the API container was replaced. Environment values and bind configuration
were compared in memory and retained without writing credentials to this report.
The original network, resource limits, read-only archive mount, and port binding
were retained. The scheduler was left running. The stopped original container
is available as `signalgen-2-go-api-rollback-20261118`.

After replacement, the API reports healthy, `/api` returns 200 through both ports,
and `/ready` returns 200 on three consecutive checks. Both lookup endpoints now
return 401 without authentication, directly and through the frontend proxy. This
confirms that the current route handlers are available and enforce authentication.
It does not establish an authenticated end-to-end screening or backtest result.

Logs also recorded transient database connect/acquire failures with `/ready`
returning 503 before this repair; readiness had recovered before replacement.
The underlying cause of those earlier database failures was not established.
No database migration, credential change, or provider download was performed.
