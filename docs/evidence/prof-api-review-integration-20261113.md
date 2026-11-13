# API harness and independent review integration

The existing `frontend/prof-revisions-integration` branch now includes the accepted
local API-stack harness, cleanup fix and bounded independent review. Both merges
preserve history and required no conflict resolution:

| Input | Exact accepted tip | Integration |
| --- | --- | --- |
| Prior integration | `25ea6006daff8ac2a70f2481f4f0e37fa06b9038` | Starting point |
| API-stack verification | `4b2173c4199345770d58cbdcf927bfd3f193fada` | Included once through the cleanup branch's ancestry |
| Cleanup reliability | `5a560a8c240f40c1ce06075cc59a70542e4c850e` | Merge `bcea204` |
| Independent review | `27298cf0c8354266c8f549339dce2a9a37780140` | Merge `e80c480067d9f8fe9e4d67e00d4c23f2e1d82423` |

The original review finding and failed Docker preflight remain unchanged as
historical evidence. R1's cleanup fix is now integrated: cleanup attempts the
remaining exact owned removals after failures, reports unresolved names, and
preserves an existing stack exception. The review's earlier statement that the
fix required separate integration describes its own source snapshot; this merge
completes that integration.

## Fresh scoped checks

All six tests in the merged `backend/scripts/test_local_api_stack.py` passed.
They cover archive/mount preflights, continuing cleanup after timeout/command/
launch failures, preservation of the original exception and bounded exact-name
success. Docker removal calls inside these tests are mocked.

Tests used the existing pinned Python image
`sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534`
through explicit local `orbstack`, with pull disabled, network none, read-only
root/source, non-root UID/GID 65534, dropped capabilities, no-new-privileges and
an empty child env allowlist. Limits were one CPU, 128 MiB RAM, 32 PIDs, 8 MiB
per file, 16 MiB scratch, 20-second child deadline and 30-second outer timeout.
Only PATH, scratch HOME/TMPDIR and PYTHONDONTWRITEBYTECODE were supplied. No
Docker socket, personal env, host credentials or shared service entered the
container. The exact owned container ID and temporary source copy were removed.

Protected product paths are byte-identical to `25ea600`: backend cmd/core/internal/
contracts, contract/go.mod/go.sum/OpenAPI, frontend src/package/lockfile and
migrations. Docker recipes/configuration are also unchanged. All requested tips
are ancestors. Whitespace, Python syntax, changed-document local links, staged
scope and credential checks passed. [Structured evidence](prof-api-review-integration-20261113.json)
records the checked source and Git object identities.

## Reused proof and remaining boundaries

The existing local image still corresponds to packaged source `2c4ad1d`; this
integration changes no protected product inputs. Earlier 262 frontend tests,
typecheck/format/build/budgets, six API-mocked browser suites and native core/
golden/race/vet checks remain evidence for that unchanged product source. They
were not rerun, and no new runtime image was built.

The earlier API-stack run proved the actual packaged API and restricted-role
PostgreSQL locally, with a mock identity HTTP provider, synthetic market histories
and a native Go feature/outcome client. Its recorded 240 assertions were not
replayed here. Browser-to-real-API remains blocked by the missing approved
isolated browser runtime. The independent review remains bounded and excludes
its author's own target metrics/UI; it is not whole-app approval.

Scheduler and publication-aware-cache work remains separate, unmerged and
unreviewed in this integration. No autonomous collector schedule or new cache
publication visibility is claimed. Real catalog/provider coverage, live Supabase,
premium-provider inputs, production recipe proof, Linux activation and staging/
physical-device/full-user-load evidence remain outstanding as recorded in the
[current gaps document](../backend/PROF_REMAINING_GAPS.md).
