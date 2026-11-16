"""Full browser UI + Worker/WASM + native IndexedDB to actual packaged API with disposable PostgreSQL.
Bounded container isolation; no published ports, ambient credentials, host Chrome, or external network.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

DOCKER = ["docker", "--context", "orbstack"]
ROOT = Path(__file__).resolve().parents[2]
API = "sha256:d4a008edc07e48837b4784a5e1be1f806bd4b8bc522f6704412719c6506f6d02"
GO = "sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61"
PG = "sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1"
PLAYWRIGHT = "sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197"
BASE = "baf888ac34e7afaa7d8495e4adfc40a4ddc23a9a"
INPUTS = [
    "backend/cmd", "backend/core", "backend/internal", "backend/contracts",
    "backend/go.mod", "backend/go.sum", "backend/contract.go", "backend/openapi.yaml",
    "supabase/migrations", "supabase/tests"
]


def call(args, timeout=60):
    if args[0] == "docker":
        args = DOCKER + args[1:]
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    streams = selectors.DefaultSelector()
    buffers = [bytearray(), bytearray()]
    streams.register(process.stdout, selectors.EVENT_READ, 0)
    streams.register(process.stderr, selectors.EVENT_READ, 1)
    deadline = time.monotonic() + timeout
    try:
        while streams.get_map():
            if time.monotonic() >= deadline:
                raise TimeoutError("Bounded process deadline exceeded: " + args[0])
            for key, _ in streams.select(timeout=0.2):
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    streams.unregister(key.fileobj)
                    continue
                buffers[key.data].extend(chunk)
                if len(buffers[key.data]) > [128 * 1024 * 1024, 1024 * 1024][key.data]:
                    raise ValueError("Process output exceeded allowlisted limit")
        process.wait(timeout=2)
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, args, bytes(buffers[0]), bytes(buffers[1]))
        return bytes(buffers[0])
    finally:
        streams.close()
        if process.poll() is None:
            process.kill()
        process.communicate()


def unpack(raw, allowed=None):
    result = {}
    if len(raw) > 128 * 1024 * 1024:
        raise ValueError("Oversized artifact archive")
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for member in archive:
            path = Path(member.name)
            if (path.is_absolute() or ".." in path.parts or not member.isfile() or
                    member.name in result or not 0 < member.size <= 32 * 1024 * 1024 or
                    (allowed is not None and member.name not in allowed)):
                raise ValueError("Unexpected artifact path/type/size")
            result[member.name] = archive.extractfile(member).read()
    if allowed is not None and set(result) != set(allowed):
        raise ValueError("Missing named artifact")
    return result


def inspect_image(ref):
    value = json.loads(call(["docker", "image", "inspect", ref]))[0]
    if value["Id"] != ref or value["Architecture"] != "arm64" or value["Config"].get("OnBuild"):
        raise ValueError("Pinned image identity/platform/hooks changed: " + ref)
    return value


def bounded(name, image, mounts=(), network="none", user="10001:10001", memory="1g", scratch=256):
    args = ["docker", "run", "--rm", "--pull=never", "--name", name, "--network", network,
            "--read-only", "--cpus", "2", "--memory", memory, "--pids-limit", "128",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", user,
            "--ulimit", "nofile=1024:1024", "--ulimit", "fsize=134217728:134217728",
            "--tmpfs", f"/scratch:rw,exec,size={scratch}m,mode=1777", "--no-healthcheck", "--log-driver", "none"]
    for item in mounts:
        src = item[0]
        dst = item[1]
        ro = ",readonly" if len(item) < 3 or item[2] else ""
        args += ["--mount", f"type=bind,src={src},dst={dst}{ro}"]
    return args + [image]


def bounded_playwright(name, image, mounts=(), network="none", user="1001:1001", memory="2g", scratch=512, shm=256):
    args = ["docker", "run", "--rm", "--pull=never", "--name", name, "--network", network,
            "--read-only", "--cpus", "2", "--memory", memory, "--pids-limit", "256",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", user,
            "--ulimit", "nofile=2048:2048", "--ulimit", "fsize=134217728:134217728",
            "--tmpfs", f"/scratch:rw,exec,size={scratch}m,mode=1777",
            "--tmpfs", f"/dev/shm:rw,exec,size={shm}m,mode=1777",
            "--no-healthcheck", "--log-driver", "none"]
    for item in mounts:
        src = item[0]
        dst = item[1]
        ro = ",readonly" if len(item) < 3 or item[2] else ""
        args += ["--mount", f"type=bind,src={src},dst={dst}{ro}"]
    return args + [image]


def cleanup_containers(names):
    """Attempt every owned removal and preserve any original stack failure."""
    original_failure = sys.exc_info()[0] is not None
    failures = []
    for name in reversed(names):
        try:
            subprocess.run(DOCKER + ["rm", "-f", name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=20, check=True)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError) as error:
            failures.append(f"{name} ({type(error).__name__})")
    if failures:
        message = "Container cleanup incomplete: " + ", ".join(failures)
        print(message, file=sys.stderr)
        if not original_failure:
            raise RuntimeError(message)


def find_toolchain_inputs():
    """Locate pre-existing node_modules with Playwright 1.64.1 and built dist."""
    node_modules_candidates = [
        ROOT / "frontend/web/node_modules",
        ROOT.parent / "frontend/web/node_modules",
        Path("/Users/lucienyudistirapurnawarman/Documents/Kuliah/signalgen-2/signalgen-2/frontend/web/node_modules"),
        ROOT.parent / "browser-regression-integration/frontend/web/node_modules",
    ]
    node_modules_path = None
    for candidate in node_modules_candidates:
        pw_pkg = candidate / "playwright/package.json"
        if pw_pkg.is_file():
            try:
                pkg_data = json.loads(pw_pkg.read_text())
                if pkg_data.get("version") == "1.64.1":
                    node_modules_path = candidate
                    break
            except Exception:
                pass
    if not node_modules_path:
        raise FileNotFoundError("Could not find local node_modules with Playwright 1.64.1")

    dist_candidates = [
        ROOT / "frontend/web/dist",
        Path("/Users/lucienyudistirapurnawarman/Documents/Kuliah/signalgen-2/signalgen-2/frontend/web/dist"),
        ROOT.parent / "browser-regression-integration/frontend/web/dist",
    ]
    dist_path = None
    for candidate in dist_candidates:
        index_html = candidate / "index.html"
        wasm_file = candidate / "wasm/signalgen_core.wasm"
        if index_html.is_file() and wasm_file.is_file():
            dist_path = candidate
            break
    if not dist_path:
        raise FileNotFoundError("Could not find local built frontend distribution directory")

    return node_modules_path, dist_path


def run():
    os.chdir(ROOT)
    call(["docker", "version", "--format", "{{.Server.Version}}"], timeout=5)
    api_img = inspect_image(API)
    pg_img = inspect_image(PG)
    go_img = inspect_image(GO)
    pw_img = inspect_image(PLAYWRIGHT)

    if api_img["Config"].get("User") != "10001:10001":
        raise ValueError("Unexpected packaged API user: " + str(api_img["Config"].get("User")))
    if api_img["Config"].get("Labels", {}).get("org.opencontainers.image.revision") != BASE:
        raise ValueError("Unexpected API source revision: " + str(api_img["Config"].get("Labels", {}).get("org.opencontainers.image.revision")))
    if pg_img["Config"].get("Entrypoint") != ["docker-entrypoint.sh"] or pg_img["Config"].get("Cmd") != ["postgres"]:
        raise ValueError("Unexpected Postgres image configuration")

    node_modules_dir, dist_dir = find_toolchain_inputs()

    scratch = Path(tempfile.mkdtemp(prefix="signalgen-browser-api-"))
    scratch.chmod(0o700)
    source = scratch / "source"
    output_dir = scratch / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_dir.chmod(0o777)

    paths = call(["git", "ls-files", *INPUTS]).decode().splitlines()
    paths += ["backend/scripts/localstack/main.go", "backend/scripts/localstack/main_test.go"]
    hashes, total = {}, 0
    for relative in paths:
        path = ROOT / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
            raise ValueError("Unsafe source input: " + relative)
        data = path.read_bytes()
        if not relative.startswith("backend/scripts/") and data != call(["git", "show", BASE + ":" + relative]):
            raise ValueError("Protected source changed: " + relative)
        total += len(data)
        if total > 64 * 1024 * 1024:
            raise ValueError("Oversized source snapshot")
        hashes[relative] = hashlib.sha256(data).hexdigest()
        dest = source / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        dest.chmod(0o444)

    names = []
    prefix = "signalgen-bstack-" + uuid.uuid4().hex[:10]

    def execute(args, seconds=60):
        name = args[args.index("--name") + 1]
        names.append(name)
        image_index = next(i for i, value in enumerate(args) if value in {API, PG, GO, PLAYWRIGHT})
        command = args[image_index + 1:]
        args = args[:image_index] + ["--entrypoint", command[0], args[image_index]] + command[1:]
        return call(args, timeout=seconds)

    try:
        print("PHASE 1: Bounded offline compile/vet/unit for Go helper", file=sys.stderr)
        cache = call(["go", "env", "GOMODCACHE"]).decode().strip()
        build = bounded(prefix + "-build", GO, [(source, "/source"), (cache, "/gomod")],
                        user="65534:65534", memory="2g", scratch=2048)
        script = """mkdir -p /scratch/home /scratch/tmp /scratch/cache /scratch/out
exec env -i PATH=/usr/local/go/bin:/usr/bin:/bin HOME=/scratch/home TMPDIR=/scratch/tmp GOCACHE=/scratch/cache GOMODCACHE=/gomod GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local CGO_ENABLED=0 timeout 360 /bin/sh -ec '
cd /source/backend
test -z "$(gofmt -l scripts/localstack/*.go)"
gofmt scripts/localstack/main.go > /scratch/out/main.go
gofmt scripts/localstack/main_test.go > /scratch/out/main_test.go
go vet ./scripts/localstack >&2
go test ./scripts/localstack >&2
go build -trimpath -o /scratch/out/localstack ./scripts/localstack
go build -trimpath -o /scratch/out/schematest ./cmd/schematest
tar -C /scratch/out -cf - localstack schematest main.go main_test.go'
"""
        artifacts = unpack(execute(build + ["/bin/sh", "-ec", script], 375),
                           {"localstack", "schematest", "main.go", "main_test.go"})
        tools = scratch / "tools"
        tools.mkdir()
        for name, data in artifacts.items():
            if name.endswith(".go"):
                continue
            if not data.startswith(b"\x7fELF"):
                raise ValueError("Non-ELF artifact")
            (tools / name).write_bytes(data)
            (tools / name).chmod(0o555)

        print("PHASE 2: Synthetic 23-stock published archive", file=sys.stderr)
        fixture = unpack(execute(bounded(prefix + "-archive", API, [(tools, "/tools")]) +
                                 ["/tools/localstack", "archive"]))
        store = scratch / "store"
        for name, data in fixture.items():
            if name != "current.json" and not name.startswith("generation-"):
                raise ValueError("Unexpected store artifact")
            path = store / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o444)

        print("PHASE 3: Disposable PostgreSQL & 14 migrations/3 policy checks", file=sys.stderr)
        pgname = prefix + "-pg"
        pgcmd = bounded(pgname, PG, user="999:999", scratch=512)
        pgcmd.insert(2, "-d")
        pgscript = """exec env -i PATH=/usr/lib/postgresql/17/bin:/usr/bin:/bin HOME=/scratch TMPDIR=/scratch timeout 480 /bin/sh -ec '
mkdir -p /scratch/tmp
initdb -D /scratch/pgdata --username=postgres --auth-local=trust --auth-host=trust >/scratch/init.log
exec postgres -D /scratch/pgdata -h 127.0.0.1 -k /scratch -c shared_buffers=32MB -c max_connections=30'
"""
        execute(pgcmd + ["/bin/sh", "-ec", pgscript])
        network = "container:" + pgname

        for attempt in range(30):
            check = bounded(prefix + "-ready-" + str(attempt), PG, network=network, user="999:999", scratch=16)
            try:
                execute(check + ["/usr/bin/env", "-i", "PATH=/usr/lib/postgresql/17/bin:/usr/bin:/bin",
                                 "HOME=/scratch", "TMPDIR=/scratch", "timeout", "5",
                                 "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], 10)
                break
            except subprocess.CalledProcessError:
                if attempt == 29:
                    raise
                time.sleep(0.2)

        create = bounded(prefix + "-createdb", PG, network=network, user="999:999", scratch=16)
        execute(create + ["/usr/bin/env", "-i", "PATH=/usr/lib/postgresql/17/bin:/usr/bin:/bin",
                          "HOME=/scratch", "TMPDIR=/scratch", "timeout", "10",
                          "createdb", "-h", "127.0.0.1", "-U", "postgres", "signalgen_test"], 15)

        schema = bounded(prefix + "-schema", GO,
                         [(tools, "/tools"), (source / "supabase", "/source/supabase")],
                         network=network, user="65534:65534", scratch=64)
        schema_result = execute(schema + ["/usr/bin/env", "-i", "PATH=/usr/bin:/bin",
                                          "HOME=/scratch", "TMPDIR=/scratch",
                                          "SIGNALGEN_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/signalgen_test?sslmode=disable",
                                          "timeout", "60", "/tools/schematest", "-repo-root", "/source"], 70).decode()

        common = [(tools, "/tools")]
        seed = execute(bounded(prefix + "-seed", API, common, network=network) +
                       ["/tools/localstack", "bootstrap"]).decode()

        print("PHASE 4: Actual API & mock identity startup in shared network namespace", file=sys.stderr)
        for mode in ["identity", "api"]:
            args = bounded(prefix + "-" + mode, API,
                           common + ([(store, "/store")] if mode == "api" else []), network=network)
            args.insert(2, "-d")
            execute(args + ["/tools/localstack", mode])

        for attempt in range(30):
            try:
                execute(bounded(prefix + "-api-ready-" + str(attempt), API, common, network=network, scratch=16) +
                        ["/tools/localstack", "ready"], 15)
                break
            except subprocess.CalledProcessError:
                if attempt == 29:
                    raise RuntimeError("Packaged API readiness did not pass in network-none namespace")
                time.sleep(0.2)

        print("PHASE 5: Browser journey execution in official Playwright container", file=sys.stderr)
        tests_dir = ROOT / "frontend/web/tests"
        pw_mounts = [
            (str(node_modules_dir), "/node_modules", True),
            (str(dist_dir), "/dist", True),
            (str(tests_dir), "/tests", True),
            (str(output_dir), "/output", False),
        ]
        pw_cmd = bounded_playwright(
            prefix + "-browser", PLAYWRIGHT, pw_mounts, network=network, user="1001:1001", memory="2g", scratch=512, shm=256
        )

        pw_runner_script = [
            "/usr/bin/env", "-i",
            "PATH=/usr/local/bin:/usr/bin:/bin",
            "HOME=/scratch",
            "TMPDIR=/scratch",
            "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
            "node",
            "/tests/browser/real-api-study.runner.mjs",
            "--dist", "/dist",
            "--port", "5174",
            "--api", "http://127.0.0.1:8080",
            "--output", "/output"
        ]
        raw_output = execute(pw_cmd + pw_runner_script, 240)
        browser_report = json.loads(raw_output)

        evidence_dir = ROOT / "docs/evidence"
        evidence_dir.mkdir(parents=True, exist_ok=True)

        copied_screenshots = []
        for png in output_dir.glob("*.png"):
            dest_png = evidence_dir / png.name
            shutil.copyfile(png, dest_png)
            copied_screenshots.append(str(dest_png.relative_to(ROOT)))

        dist_hashes = {}
        for root_p, _, files in os.walk(dist_dir):
            for f in sorted(files):
                full_p = Path(root_p) / f
                rel_p = str(full_p.relative_to(dist_dir))
                dist_hashes[rel_p] = hashlib.sha256(full_p.read_bytes()).hexdigest()

        evidence = {
            "date": "2026-11-16",
            "branch": "frontend/prof-browser-real-api",
            "status": "pass",
            "source_base": BASE,
            "images": {
                "api": API,
                "postgres": PG,
                "toolchain": GO,
                "playwright": PLAYWRIGHT,
            },
            "isolation": {
                "network": "none",
                "namespace": "shared loopback container namespace owned by disposable PG",
                "published_ports": "none",
                "docker_socket_mounted": False,
                "ambient_credentials": False,
                "root_filesystem": "readonly",
                "privilege_escalation": "no-new-privileges",
                "capabilities": "cap-drop ALL",
                "playwright_user": "1001:1001 (pwuser)",
                "api_user": "10001:10001",
                "pg_user": "999:999",
                "shared_memory": "private bounded /dev/shm 256MB tmpfs (no ipc=host)",
            },
            "schema_check": schema_result.strip(),
            "bootstrap": seed.strip(),
            "browser_report": browser_report,
            "screenshots": copied_screenshots,
            "dist_source": {
                "path": str(dist_dir),
                "total_files": len(dist_hashes),
                "wasm_sha256": dist_hashes.get("wasm/signalgen_core.wasm"),
                "index_sha256": dist_hashes.get("index.html"),
            },
            "verified_boundaries": {
                "mock_upstream_idp_only": True,
                "mock_prices_only": True,
                "real_go_api": True,
                "real_postgresql": True,
                "real_wasm_computation": True,
                "real_indexeddb_storage": True,
                "no_api_route_fulfil": True,
                "owner_isolation_verified": True,
                "screening_no_auto_outcomes": True,
                "evaluation_private_scoring": True,
                "csv_export_verified": True,
                "recovery_and_capacity_verified": True,
            }
        }

        evidence_json_path = evidence_dir / "browser-real-api-20261116.json"
        evidence_json_path.write_text(json.dumps(evidence, indent=2) + "\n")

        print(json.dumps(evidence, indent=2))
        return evidence
    except subprocess.CalledProcessError as err:
        print(err.stderr.decode(errors="replace")[-4000:], file=sys.stderr)
        raise
    finally:
        cleanup_containers(names)
        try:
            shutil.rmtree(scratch)
        except Exception:
            pass


if __name__ == "__main__":
    run()
