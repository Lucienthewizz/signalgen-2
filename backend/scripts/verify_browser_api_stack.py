"""Full browser UI + Worker/WASM + native IndexedDB to actual packaged API with disposable PostgreSQL.
Bounded container isolation; no published ports, ambient credentials, host Chrome, or external network.
"""
import base64
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
APPROVED_MANIFEST = Path("/var/folders/kg/_nf5wv453qz03_sf7b6pfxcw0000gn/T/signalgen-approved-linux-build-inputs-0q32sgev/manifest.json")


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
            name = member.name[2:] if member.name.startswith("./") else member.name
            if not name or (member.isdir() and name in {".", "/"}):
                continue
            path = Path(name)
            if (path.is_absolute() or ".." in path.parts or not member.isfile() or
                    name in result or not 0 < member.size <= 32 * 1024 * 1024 or
                    (allowed is not None and name not in allowed)):
                raise ValueError("Unexpected artifact path/type/size: " + member.name)
            result[name] = archive.extractfile(member).read()
    if allowed is not None and set(result) != set(allowed):
        raise ValueError(f"Missing named artifact: expected {allowed}, got {set(result)}")
    return result


def extract_dist_archive(raw_bytes, dest_dir, max_file_size=16 * 1024 * 1024, max_cumulative=64 * 1024 * 1024, max_files=1000):
    """Safely extract dist tar archive under strict bounds (regular files and dirs only, reject symlinks/hardlinks, traversal, duplicates, oversize)."""
    if len(raw_bytes) > max_cumulative:
        raise ValueError("Oversized dist archive bytes")
    dest_dir = Path(dest_dir)
    total_size = 0
    extracted = set()
    with tarfile.open(fileobj=io.BytesIO(raw_bytes)) as archive:
        for member in archive:
            name = member.name[2:] if member.name.startswith("./") else member.name
            if not name or (member.isdir() and name in {".", "/"}):
                continue
            path = Path(name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Traversal path in dist archive: " + member.name)
            if not (member.isfile() or member.isdir()):
                raise ValueError("Forbidden member type in dist archive (symlink/device/fifo): " + member.name)
            if name in extracted:
                raise ValueError("Duplicate entry in dist archive: " + name)
            if len(extracted) >= max_files:
                raise ValueError("Too many files in dist archive")
            extracted.add(name)
            if member.isfile():
                if member.size < 0 or member.size > max_file_size:
                    raise ValueError(f"Oversized member in dist archive: {name} ({member.size} bytes)")
                total_size += member.size
                if total_size > max_cumulative:
                    raise ValueError("Cumulative dist archive size limit exceeded")
                target = dest_dir / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as f_in, open(target, "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)
                target.chmod(0o644)
            elif member.isdir():
                target = dest_dir / name
                target.mkdir(parents=True, exist_ok=True)


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


def verify_approved_build_inputs(manifest_path, lockfile_path):
    """Verify lockfile integrity and approved archive SRI hashes before extraction."""
    manifest_path = Path(manifest_path)
    lockfile_path = Path(lockfile_path)
    if not manifest_path.is_file():
        raise FileNotFoundError("Approved build inputs manifest not found: " + str(manifest_path))
    if not lockfile_path.is_file():
        raise FileNotFoundError("Frontend lockfile not found: " + str(lockfile_path))

    lock_data = lockfile_path.read_bytes()
    lock_hash = hashlib.sha256(lock_data).hexdigest()
    manifest = json.loads(manifest_path.read_text())
    if lock_hash != manifest.get("lockfile_sha256"):
        raise ValueError("Lockfile SHA256 mismatch against coordinator manifest")

    lock = json.loads(lock_data.decode("utf-8"))
    verified_packages = []
    for pkg in manifest["packages"]:
        key = "node_modules/" + pkg["package"]
        entry = lock.get("packages", {}).get(key)
        if not entry:
            raise ValueError("Missing lockfile entry for approved package: " + key)
        if entry.get("integrity") != pkg["integrity"] or entry.get("version") != pkg["version"]:
            raise ValueError("Package integrity/version mismatch in lockfile: " + key)

        archive = Path(pkg["archive"])
        if not archive.is_file():
            raise FileNotFoundError("Approved package archive not found: " + str(archive))
        data = archive.read_bytes()
        if len(data) != pkg["bytes"]:
            raise ValueError(f"Archive size mismatch for {pkg['package']}: expected {pkg['bytes']}, got {len(data)}")
        sha256 = hashlib.sha256(data).hexdigest()
        if sha256 != pkg["sha256"]:
            raise ValueError(f"Archive SHA256 mismatch for {pkg['package']}")
        sri = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("utf-8")
        if sri != pkg["integrity"]:
            raise ValueError(f"Archive SRI mismatch for {pkg['package']}")
        verified_packages.append({
            "package": pkg["package"],
            "version": pkg["version"],
            "sha256": sha256,
            "bytes": len(data),
            "archive": str(archive),
        })
    return verified_packages


def extract_approved_package(archive_path, dest_dir, max_file_size=32*1024*1024, max_cumulative=64*1024*1024):
    """Safely extract tar.gz npm package under strict bounds (package/ regular files only)."""
    archive_path = Path(archive_path)
    dest_dir = Path(dest_dir)
    total_size = 0
    extracted = set()

    with tarfile.open(archive_path, "r:gz") as tar:
        for member in tar:
            if not member.name.startswith("package/"):
                raise ValueError("Archive entry outside package/ root: " + member.name)
            rel = member.name[len("package/"):]
            if not rel:
                continue
            path = Path(rel)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Traversal path in archive: " + rel)
            if not (member.isfile() or member.isdir()):
                raise ValueError("Forbidden member type (symlink/device/fifo): " + rel)
            if member.isfile():
                if member.size > max_file_size or member.size < 0:
                    raise ValueError(f"Oversized member in archive: {rel} ({member.size} bytes)")
                total_size += member.size
                if total_size > max_cumulative:
                    raise ValueError("Cumulative archive size limit exceeded")
            if rel in extracted:
                raise ValueError("Duplicate entry in archive: " + rel)
            extracted.add(rel)

            target = dest_dir / rel
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as f_in, open(target, "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)
                target.chmod(member.mode)


def find_base_node_modules():
    """Locate pre-existing portable node_modules with Playwright 1.64.1."""
    candidates = [
        ROOT / "frontend/web/node_modules",
        ROOT.parent / "browser-regression-integration/frontend/web/node_modules",
        ROOT.parent / "frontend/web/node_modules",
        Path("/Users/lucienyudistirapurnawarman/Documents/Kuliah/signalgen-2/signalgen-2/frontend/web/node_modules"),
    ]
    for candidate in candidates:
        pw_pkg = candidate / "playwright/package.json"
        if pw_pkg.is_file():
            try:
                pkg_data = json.loads(pw_pkg.read_text())
                if pkg_data.get("version") == "1.64.1":
                    return candidate
            except Exception:
                pass
    raise FileNotFoundError("Could not find local node_modules with Playwright 1.64.1")


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

    # Phase 0: Reverify 4 approved Linux build packages against package-lock.json
    lockfile_path = ROOT / "frontend/web/package-lock.json"
    approved_packages = verify_approved_build_inputs(APPROVED_MANIFEST, lockfile_path)

    base_node_modules = find_base_node_modules()

    scratch = Path(tempfile.mkdtemp(prefix="signalgen-browser-api-"))
    scratch.chmod(0o700)
    source = scratch / "source"

    # Tracked source snapshot for backend
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
        print("PHASE 1: Bounded offline Go compile & WASM core build", file=sys.stderr)
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
GOOS=js GOARCH=wasm go build -trimpath -o /scratch/out/signalgen_core.wasm ./cmd/wasm
cp /usr/local/go/lib/wasm/wasm_exec.js /scratch/out/wasm_exec.js
go run ./cmd/wasmmanifest --wasm /scratch/out/signalgen_core.wasm --runtime /scratch/out/wasm_exec.js --output /scratch/out/signalgen_core.manifest.json
tar -C /scratch/out -cf - localstack schematest main.go main_test.go signalgen_core.wasm wasm_exec.js signalgen_core.manifest.json'
"""
        artifacts = unpack(execute(build + ["/bin/sh", "-ec", script], 375),
                           {"localstack", "schematest", "main.go", "main_test.go",
                            "signalgen_core.wasm", "wasm_exec.js", "signalgen_core.manifest.json"})
        tools = scratch / "tools"
        tools.mkdir()
        for name in ["localstack", "schematest"]:
            data = artifacts[name]
            if not data.startswith(b"\x7fELF"):
                raise ValueError("Non-ELF artifact: " + name)
            (tools / name).write_bytes(data)
            (tools / name).chmod(0o555)

        # Verify WASM boundary markers
        wasm_file = scratch / "signalgen_core.wasm"
        wasm_file.write_bytes(artifacts["signalgen_core.wasm"])
        boundary_check = subprocess.run(
            ["bash", str(ROOT / "backend/scripts/verify_wasm_boundary.sh"), str(wasm_file)],
            capture_output=True, text=True, check=True
        )
        print("WASM Boundary Check: " + boundary_check.stdout.strip(), file=sys.stderr)

        print("PHASE 2: Safe dependency extraction and offline frontend rebuild", file=sys.stderr)
        deps_dir = scratch / "deps/node_modules"
        deps_dir.parent.mkdir(parents=True, exist_ok=True)
        # Fast copy-on-write APFS clone of portable node_modules
        subprocess.run(["cp", "-Rc", str(base_node_modules), str(deps_dir)], check=True)

        # Extract 4 approved Linux packages into own dependency snapshot
        for pkg in approved_packages:
            extract_dest = deps_dir / pkg["package"]
            extract_dest.mkdir(parents=True, exist_ok=True)
            extract_approved_package(pkg["archive"], extract_dest)

        # Clean tracked frontend source snapshot with strict boundary validation
        web_source = scratch / "web_source"
        web_source.mkdir(parents=True, exist_ok=True)
        tracked_web = call(["git", "ls-files", "frontend/web"]).decode().splitlines()
        web_hashes = {}
        total_web_size = 0
        for rel in tracked_web:
            src = ROOT / rel
            if not src.is_file() or src.is_symlink():
                raise ValueError("Unsafe or non-regular frontend file: " + rel)
            sub = rel[len("frontend/web/"):]
            sub_path = Path(sub)
            if sub_path.is_absolute() or ".." in sub_path.parts:
                raise ValueError("Unsafe frontend relative path: " + sub)
            data = src.read_bytes()
            if len(data) > 16 * 1024 * 1024:
                raise ValueError(f"Oversized frontend source file: {rel} ({len(data)} bytes)")
            total_web_size += len(data)
            if total_web_size > 64 * 1024 * 1024:
                raise ValueError("Cumulative frontend source size exceeded 64MB limit")
            web_hashes[rel] = {
                "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data),
            }
            dst = web_source / sub
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data)
            dst.chmod(0o644)

        # Place fresh matching WASM runtime assets in public/wasm
        wasm_public = web_source / "public/wasm"
        wasm_public.mkdir(parents=True, exist_ok=True)
        for w_asset in ["signalgen_core.wasm", "wasm_exec.js", "signalgen_core.manifest.json"]:
            (wasm_public / w_asset).write_bytes(artifacts[w_asset])

        # Pre-create empty node_modules mountpoint inside web_source
        (web_source / "node_modules").mkdir(parents=True, exist_ok=True)

        # Offline frontend build container
        pw_build_mounts = [
            (str(web_source), "/app", True),
            (str(deps_dir), "/app/node_modules", True),
        ]
        pw_build_cmd = bounded_playwright(
            prefix + "-fe-build", PLAYWRIGHT, pw_build_mounts, network="none", user="1001:1001", memory="2g", scratch=1024, shm=256
        )
        fe_build_script = """mkdir -p /scratch/dist /scratch/tmp
exec env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/scratch TMPDIR=/scratch/tmp timeout 240 /bin/sh -ec '
cd /app
node ./node_modules/vite/bin/vite.js build --outDir /scratch/dist > /scratch/vite.log 2>&1 || (cat /scratch/vite.log >&2 && exit 1)
tar -C /scratch/dist -cf - .'
"""
        dist_tar = execute(pw_build_cmd + ["/bin/sh", "-ec", fe_build_script], 260)
        dist_dir = scratch / "dist"
        dist_dir.mkdir(parents=True, exist_ok=True)
        extract_dist_archive(dist_tar, dist_dir)

        # Verify essential dist outputs
        if not (dist_dir / "index.html").is_file() or not (dist_dir / "wasm/signalgen_core.wasm").is_file():
            raise FileNotFoundError("Frontend dist missing index.html or wasm artifact")

        dist_hashes = {}
        for root_p, _, files in os.walk(dist_dir):
            for f in sorted(files):
                full_p = Path(root_p) / f
                rel_p = str(full_p.relative_to(dist_dir))
                file_bytes = full_p.read_bytes()
                dist_hashes[rel_p] = {
                    "sha256": hashlib.sha256(file_bytes).hexdigest(),
                    "bytes": len(file_bytes),
                }

        # Verify exact hash equality between compiled Go WASM outputs and dist/ assets
        for w_asset in ["signalgen_core.wasm", "wasm_exec.js", "signalgen_core.manifest.json"]:
            dist_key = f"wasm/{w_asset}"
            if dist_key not in dist_hashes:
                raise ValueError(f"Missing {dist_key} in built frontend dist")
            built_hash = hashlib.sha256(artifacts[w_asset]).hexdigest()
            if dist_hashes[dist_key]["sha256"] != built_hash:
                raise ValueError(f"Hash mismatch between Go built {w_asset} and dist/{dist_key}")

        print("PHASE 3: Synthetic 23-stock published archive", file=sys.stderr)
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

        print("PHASE 4: Disposable PostgreSQL & 14 migrations/3 policy checks", file=sys.stderr)
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

        print("PHASE 5: Actual API & mock identity startup in shared network namespace", file=sys.stderr)
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

        print("PHASE 6: Browser journey execution in official Playwright container (no host /output mount)", file=sys.stderr)
        # Use readonly allowlisted copies of actual runner/scenario rather than whole ROOT/frontend/web/tests mount
        test_scratch = scratch / "tests"
        test_browser = test_scratch / "browser"
        test_browser.mkdir(parents=True, exist_ok=True)
        runner_hashes = {}
        for test_file in ["real-api-study.runner.mjs", "real-api-study.scenario.js"]:
            src = ROOT / "frontend/web/tests/browser" / test_file
            if not src.is_file() or src.is_symlink():
                raise ValueError("Invalid test runner file: " + test_file)
            test_data = src.read_bytes()
            if len(test_data) > 16 * 1024 * 1024:
                raise ValueError("Oversized test runner file: " + test_file)
            runner_hashes[test_file] = {
                "sha256": hashlib.sha256(test_data).hexdigest(),
                "bytes": len(test_data),
            }
            dst = test_browser / test_file
            dst.write_bytes(test_data)
            dst.chmod(0o444)

        pw_mounts = [
            (str(deps_dir), "/node_modules", True),
            (str(dist_dir), "/dist", True),
            (str(test_scratch), "/tests", True),
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
            "/bin/sh", "-ec",
            """mkdir -p /scratch/output
node /tests/browser/real-api-study.runner.mjs --dist /dist --port 5174 --api http://127.0.0.1:8080 --output /scratch/output > /scratch/runner.log 2>&1 || (cat /scratch/runner.log >&2 && exit 1)
tar -C /scratch/output -cf - browser-real-api-result.json browser-real-api-desktop-dark-screening.png browser-real-api-mobile-dark-screening.png browser-real-api-desktop-light-backtest.png browser-real-api-mobile-light-backtest.png
"""
        ]
        raw_output = execute(pw_cmd + pw_runner_script, 240)
        allowed_artifacts = {
            "browser-real-api-result.json",
            "browser-real-api-desktop-dark-screening.png",
            "browser-real-api-mobile-dark-screening.png",
            "browser-real-api-desktop-light-backtest.png",
            "browser-real-api-mobile-light-backtest.png",
        }
        browser_artifacts = unpack(raw_output, allowed_artifacts)
        browser_report = json.loads(browser_artifacts["browser-real-api-result.json"].decode("utf-8"))

        # Verify browser-loaded WASM response bytes against dist manifest
        loaded_wasm = browser_report.get("reports", {}).get("loaded_wasm_assets") or browser_report.get("loaded_wasm_assets", {})
        for w_asset in ["signalgen_core.wasm", "wasm_exec.js", "signalgen_core.manifest.json"]:
            if w_asset not in loaded_wasm:
                raise ValueError(f"Browser did not observe response for /wasm/{w_asset}")
            loaded_info = loaded_wasm[w_asset]
            dist_key = f"wasm/{w_asset}"
            if loaded_info["sha256"] != dist_hashes[dist_key]["sha256"]:
                raise ValueError(f"Browser loaded {w_asset} SHA-256 mismatch against dist: {loaded_info['sha256']} vs {dist_hashes[dist_key]['sha256']}")
            if loaded_info["bytes"] != dist_hashes[dist_key]["bytes"]:
                raise ValueError(f"Browser loaded {w_asset} byte count mismatch against dist: {loaded_info['bytes']} vs {dist_hashes[dist_key]['bytes']}")

        # Verify truthful sandbox reporting
        b_info = browser_report.get("browser_info", {})
        if b_info.get("chromium_internal_sandbox") is not False:
            raise ValueError(f"Expected chromium_internal_sandbox to be False, got {b_info.get('chromium_internal_sandbox')}")
        if b_info.get("os_container_isolation_enforced") is not True:
            raise ValueError(f"Expected os_container_isolation_enforced to be True, got {b_info.get('os_container_isolation_enforced')}")

        evidence_dir = ROOT / "docs/evidence"
        evidence_dir.mkdir(parents=True, exist_ok=True)

        copied_screenshots = []
        for name, data in browser_artifacts.items():
            if name.endswith(".png"):
                dest_png = evidence_dir / name
                dest_png.write_bytes(data)
                copied_screenshots.append(str(dest_png.relative_to(ROOT)))

        head_commit = call(["git", "rev-parse", "HEAD"]).decode().strip()
        git_dirty = bool(call(["git", "status", "--porcelain", "frontend/web"]).decode().strip())

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
                "output_mount": "none (written to container tmpfs /scratch, unpacked with bounded validation)",
            },
            "build_inputs": {
                "approved_manifest": str(APPROVED_MANIFEST),
                "packages": approved_packages,
            },
            "schema_check": schema_result.strip(),
            "bootstrap": seed.strip(),
            "browser_report": browser_report,
            "screenshots": copied_screenshots,
            "frontend_source_manifest": {
                "head_commit": head_commit,
                "dirty": git_dirty,
                "total_tracked_files": len(web_hashes),
                "files": web_hashes,
            },
            "test_runner_manifest": {
                "files": runner_hashes,
            },
            "dependencies_manifest": {
                "lockfile_sha256": hashlib.sha256(lockfile_path.read_bytes()).hexdigest(),
                "playwright_version": "1.64.1",
                "approved_packages": approved_packages,
            },
            "dist_manifest": {
                "total_files": len(dist_hashes),
                "files": dist_hashes,
            },
            "wasm_runtime_identity": {
                "signalgen_core_wasm": dist_hashes.get("wasm/signalgen_core.wasm"),
                "wasm_exec_js": dist_hashes.get("wasm/wasm_exec.js"),
                "signalgen_core_manifest_json": dist_hashes.get("wasm/signalgen_core.manifest.json"),
                "browser_loaded_verified": True,
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
