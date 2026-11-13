# Local Docker runtime candidate

This local offline packaging path compiles the Go source at
`5bb111d626625bede93e4f7d590c19227a247699` and verifies a new runtime image.
It does not build the unmodified production `backend/Go.Dockerfile`, update its
base packages, deploy a service or establish full authenticated API health.

## What the local path does

[build_local_runtime.py](../../backend/scripts/build_local_runtime.py) verifies
the protected tracked Go inputs against the source commit and copies only those
files into a private task directory. It does not mount the original backend
directory or include `.env`, runtime databases or ignored files. Compilation uses
the existing immutable Go image and read-only module cache, with downloads and
external network disabled. All five binaries are rebuilt: API, admin, catalog
audit, healthcheck and IDX collector. A static collection test binary is built
only for verification and is not packaged into the runtime image.

The helper reviews a pre-existing local runtime input image by immutable ID,
rejecting ONBUILD/entrypoint hooks, unexpected command/user or environment names.
It copies just its CA bundle and passwd/group files from a stopped container,
validates bounded regular tar members and parses the CA bundle offline.
[LocalRuntime.Dockerfile](../../backend/LocalRuntime.Dockerfile) starts from
the built-in `scratch` base and copies those reviewed data files, the five new
binaries, the existing fixture and license. No RUN, installer, remote base,
inherited application binary or old OS executable is included. The original
Dockerfile and default Compose configuration remain unchanged.

The runtime uses UID/GID 10001, root-owned executable binaries, a read-only
rootfs and a private bounded scratch mount during verification. The API command
and healthcheck are configured, but the authenticated API was not started.
Its Supabase URL/key/database settings and an authorized deployment environment
remain prerequisites. The frontend and its matching WASM are separate artifacts.

## Reproduce locally

From the repository root, using the existing Python standard library, Go CLI,
Docker and locally cached images/modules:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/test_local_runtime.py
PYTHONDONTWRITEBYTECODE=1 python3 backend/scripts/build_local_runtime.py
```

The helper prints source SHA, runtime-input/toolchain IDs, final image ID,
binary hashes, smoke output and its private scratch/report path. It fails if a
pinned image is missing; it does not pull a replacement. Use the printed image
ID for later configuration.
Image digests and the actual checks are in
[local verification evidence](../evidence/local-docker-runtime-20261112.json).

Verified local candidate image:
`sha256:81b7976006b8502be46fd1ea18830c6c395b8d5c8ec30bdd8aac5bc8a65a9882`.
Runtime CA/identity input image:
`sha256:f1baf33b1e06c6a7b54f6226cf758785efd2efe99a358c9f613aa906da2077f4`.
The toolchain identity, all five binary digests and protected input hashes are
recorded separately in the evidence. This candidate is Linux arm64 on the
verified local Docker installation; other architectures were not tested.

Compilation is restricted to 2 CPUs, 2 GiB RAM, 256 PIDs, a 2 GiB executable
scratch tmpfs, 128 MiB per-file writes and 360 seconds, with bounded captured
output. Source, toolchain and module cache are read-only. The child starts with
`env -i`, scratch HOME/TMPDIR/cache and offline Go settings. No Docker socket or
host credential directory is exposed inside the child.

Packaging is a trusted parent COPY-only operation over explicitly named,
size/type/digest-checked artifacts. Runtime smokes disable networking, use
UID/GID 10001, drop capabilities, enable no-new-privileges, and bound CPU, RAM,
PIDs, file size, scratch disk and wall time. The reviewed final image and explicit
safe Docker environment form the runtime child's environment allowlist.

## Publication-aware local configuration

[docker-compose.local-runtime.yml](../../docker-compose.local-runtime.yml) is
standalone. It does not inherit the default Compose file's `backend/.env`.
Always pass an explicit empty interpolation env file and explicit variables:

```sh
SIGNALGEN_LOCAL_IMAGE='sha256:<verified local image ID>' \
SIGNALGEN_LOCAL_API_ENV_FILE='/absolute/explicit-api-settings-file' \
SIGNALGEN_LOCAL_IDX_STORE='/absolute/private/published-idx-store' \
SIGNALGEN_LOCAL_IDX_CATALOG='/absolute/private/idx-catalog.csv' \
docker compose --env-file /dev/null --profile collector \
  -f docker-compose.local-runtime.yml config --quiet
```

Select the API settings file explicitly. The helper validates configuration
with an empty synthetic service-env file and synthetic catalog/store paths.
No real credentials or settings were loaded or printed in verification.

`go-api` selects publication-aware `idx_store`, mounts an existing private store
read-only, binds only loopback, and never builds or pulls an image. The store
must already contain a valid completed publication. The separate opt-in
`collector` profile mounts the operator catalog read-only and the private state
directory writable. Bind paths are explicit and must exist; Compose will not
create a missing path. On a real host, arrange ownership/access for UID/GID 10001
and keep state private; do not make a real catalog/store world-writable to work
around permissions.
The pull and bind choices follow the
[Docker Compose service reference](https://github.com/docker/docs/blob/main/content/reference/compose-file/services.md);
the explicit interpolation file follows
[Docker's environment-file guidance](https://github.com/docker/docs/blob/main/content/manuals/compose/how-tos/environment-variables/variable-interpolation.md).

The collector's default is `-validate-only` with networking disabled. It neither
downloads prices nor changes a publication. A deliberate local one-shot may use
existing prune-only/dry-run flags against an operator-selected store. The writable
state mount is separate from the API's read-only view. Actual acquisition and
provider networking are not enabled or verified by this candidate.

The separate opt-in scheduler profile now runs the collector serially without
the website or a cron dependency. See the [scheduler guide](LOCAL_IDX_SCHEDULER.md)
for its required catalog, provider networking, private state and retry settings.
The one-shot collector retains its safe default above. Linux systemd activation
is not required for the current macOS local-Docker target; no unit or real-provider
scheduled job was activated by this verification.

## Verification and cleanup boundaries

The image's actual collector passed help and synthetic catalog validation.
The existing synthetic collection smoke ran inside this new runtime image using
the separately mounted static test binary: five incremental publications,
read-only-store reads and prune dry-run passed. All five packaged application
binaries were copied back from a stopped image container and byte-compared with
the rebuilt artifacts. Read-only root/catalog writes and missing bind sources
were rejected. These checks do not start a fake-auth API or substitute for
Supabase-backed API health.

Verification containers are uniquely named and removed automatically; timeout
cleanup targets only that invocation's container. The helper leaves its printed
private task directory/report for inspection and the local candidate image.
After saving the report, remove only that exact generated directory if desired.
No general image prune, worktree deletion or daemon reconfiguration is needed.

The original full recipe remains unverified under its required offline per-RUN
controls. This candidate reuses CA/identity data from an existing local image;
it makes no package-freshness or production-hardening claim. Real IDX coverage,
freshness, live Yahoo/premium data, cloud deployment and sustained/full-user-load
performance remain outside these local checks.
