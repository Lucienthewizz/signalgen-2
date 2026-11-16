"""Disposable offline API/PG stack; no Docker ports, personal env or cloud inputs."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import selectors
import sys
import tarfile
import tempfile
import time
import uuid

DOCKER = ["docker", "--context", "orbstack"]
ROOT = Path(__file__).resolve().parents[2]
API = "sha256:cf5e1397b73b4e463b360897f19f5ac0fe02470288b025dd1114a614efa85a50"
GO = "sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61"
PG = "sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1"
BASE = "25ea6006daff8ac2a70f2481f4f0e37fa06b9038"
INPUTS = ["backend/cmd", "backend/core", "backend/internal", "backend/contracts", "backend/go.mod", "backend/go.sum", "backend/contract.go", "backend/openapi.yaml", "supabase/migrations", "supabase/tests"]


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
                if len(buffers[key.data]) > [128*1024*1024, 1024*1024][key.data]:
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


def inspect(ref):
    value = json.loads(call(["docker", "image", "inspect", ref]))[0]
    if value["Id"] != ref or value["Architecture"] != "arm64" or value["Config"].get("OnBuild"):
        raise ValueError("Pinned image identity/platform/hooks changed")
    return value


def bounded(name, image, mounts=(), network="none", user="10001:10001", memory="1g", scratch=256):
    args = ["docker", "run", "--rm", "--pull=never", "--name", name, "--network", network,
            "--read-only", "--cpus", "2", "--memory", memory, "--pids-limit", "128",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", user,
            "--ulimit", "nofile=1024:1024", "--ulimit", "fsize=134217728:134217728",
            "--tmpfs", f"/scratch:rw,exec,size={scratch}m,mode=1777", "--no-healthcheck", "--log-driver", "none"]
    for src, dst in mounts:
        args += ["--mount", f"type=bind,src={src},dst={dst},readonly"]
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


def run():
    os.chdir(ROOT)
    call(["docker", "version", "--format", "{{.Server.Version}}"], timeout=5)
    api, pg, go = inspect(API), inspect(PG), inspect(GO)
    if api["Config"].get("User") != "10001:10001" or api["Config"].get("Entrypoint"):
        raise ValueError("Unexpected packaged API user/entrypoint")
    if api["Config"].get("Labels", {}).get("org.opencontainers.image.revision") != "2c4ad1dfbb6a045b7d5a6968eacf971b6f3b81e2":
        raise ValueError("Unexpected API source revision")
    # Bypass reviewed stock entrypoints; initialization writes only bounded private tmpfs.
    if pg["Config"].get("Entrypoint") != ["docker-entrypoint.sh"] or pg["Config"].get("Cmd") != ["postgres"]:
        raise ValueError("Unexpected Postgres image configuration")
    scratch = Path(tempfile.mkdtemp(prefix="signalgen-local-api-"))
    scratch.chmod(0o700)
    source = scratch / "source"
    paths = call(["git", "ls-files", *INPUTS]).decode().splitlines()
    paths += ["backend/scripts/localstack/main.go", "backend/scripts/localstack/main_test.go"]
    hashes, total = {}, 0
    for relative in paths:
        path = ROOT / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 16*1024*1024:
            raise ValueError("Unsafe source input")
        data = path.read_bytes()
        if not relative.startswith("backend/scripts/") and data != call(["git", "show", BASE + ":" + relative]):
            raise ValueError("Protected source changed: " + relative)
        total += len(data)
        if total > 64*1024*1024:
            raise ValueError("Oversized source snapshot")
        hashes[relative] = hashlib.sha256(data).hexdigest()
        dest = source / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        dest.chmod(0o444)
    names = []
    prefix = "signalgen-stack-" + uuid.uuid4().hex[:10]
    def execute(args, seconds=60):
        name = args[args.index("--name")+1]
        names.append(name)
        # Override inherited image entrypoints; execute only the explicit reviewed command.
        image_index = next(i for i, value in enumerate(args) if value in {API, PG, GO})
        command = args[image_index+1:]
        args = args[:image_index] + ["--entrypoint", command[0], args[image_index]] + command[1:]
        return call(args, timeout=seconds)
    try:
        print("PHASE bounded offline compile/vet/unit", file=__import__("sys").stderr)
        # Existing Go modules only; all compiler outputs stay inside 2GiB tmpfs.
        cache = call(["go", "env", "GOMODCACHE"]).decode().strip()
        build = bounded(prefix+"-build", GO, [(source, "/source"), (cache, "/gomod")], user="65534:65534", memory="2g", scratch=2048)
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
        artifacts = unpack(execute(build + ["/bin/sh", "-ec", script], 375), {"localstack", "schematest", "main.go", "main_test.go"})
        tools = scratch / "tools"
        tools.mkdir()
        for name, data in artifacts.items():
            if name.endswith(".go"):
                (scratch / ("formatted-"+name)).write_bytes(data)
                continue
            if not data.startswith(b"\x7fELF"):
                raise ValueError("Non-ELF artifact")
            (tools / name).write_bytes(data)
            (tools / name).chmod(0o555)
        print("PHASE synthetic published store", file=__import__("sys").stderr)
        fixture = unpack(execute(bounded(prefix+"-archive", API, [(tools,"/tools")]) + ["/tools/localstack", "archive"]))
        store = scratch / "store"
        for name, data in fixture.items():
            if name != "current.json" and not name.startswith("generation-"):
                raise ValueError("Unexpected store artifact")
            path = store / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o444)
        # Private loopback namespace belongs to this disposable PG container only.
        print("PHASE private Postgres/schema", file=__import__("sys").stderr)
        pgname = prefix + "-pg"
        pgcmd = bounded(pgname, PG, user="999:999", scratch=512)
        pgcmd.insert(2, "-d")
        pgscript = """exec env -i PATH=/usr/lib/postgresql/17/bin:/usr/bin:/bin HOME=/scratch TMPDIR=/scratch timeout 480 /bin/sh -ec '
mkdir -p /scratch/tmp
initdb -D /scratch/pgdata --username=postgres --auth-local=trust --auth-host=trust >/scratch/init.log
exec postgres -D /scratch/pgdata -h 127.0.0.1 -k /scratch -c shared_buffers=32MB -c max_connections=30'
"""
        execute(pgcmd + ["/bin/sh", "-ec", pgscript])
        network="container:"+pgname
        # Wait via the isolated trusted client, never host/shared Postgres.
        for attempt in range(30):
            check = bounded(prefix+"-ready-"+str(attempt), PG, network=network, user="999:999", scratch=16)
            try:
                execute(check+["/usr/bin/env", "-i", "PATH=/usr/lib/postgresql/17/bin:/usr/bin:/bin", "HOME=/scratch", "TMPDIR=/scratch", "timeout", "5", "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],10)
                break
            except subprocess.CalledProcessError:
                if attempt == 29:
                    raise
                time.sleep(0.2)
        create = bounded(prefix+"-createdb", PG, network=network, user="999:999", scratch=16)
        execute(create+["/usr/bin/env","-i","PATH=/usr/lib/postgresql/17/bin:/usr/bin:/bin","HOME=/scratch","TMPDIR=/scratch","timeout","10","createdb","-h","127.0.0.1","-U","postgres","signalgen_test"],15)
        # schematest applies current migrations and checks only the fresh signalgen_test DB.
        schema = bounded(prefix+"-schema", GO, [(tools,"/tools"),(source / "supabase","/source/supabase")], network=network, user="65534:65534", scratch=64)
        schema_result=execute(schema+["/usr/bin/env","-i","PATH=/usr/bin:/bin","HOME=/scratch","TMPDIR=/scratch","SIGNALGEN_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/signalgen_test?sslmode=disable","timeout","60","/tools/schematest","-repo-root","/source"],70).decode()
        common=[(tools,"/tools")]
        seed=execute(bounded(prefix+"-seed",API,common,network=network)+["/tools/localstack","bootstrap"]).decode()
        print("PHASE actual API/identity startup", file=__import__("sys").stderr)
        for mode in ["identity","api"]:
            args=bounded(prefix+"-"+mode,API,common+([(store,"/store")] if mode=="api" else []),network=network)
            args.insert(2,"-d")
            execute(args+["/tools/localstack",mode])
        # No host port publication. API readiness polling and requests stay in loopback namespace.
        for attempt in range(30):
            try:
                execute(bounded(prefix+"-api-ready-"+str(attempt),API,common,network=network,scratch=16)+["/tools/localstack","ready"],15)
                break
            except subprocess.CalledProcessError:
                if attempt==29:
                    raise RuntimeError("Packaged API readiness did not pass; inspect only own container logs")
                time.sleep(0.2)
        print("PHASE actual HTTP business checks", file=__import__("sys").stderr)
        raw=execute(bounded(prefix+"-verify",API,common,network=network,memory="1g",scratch=64)+["/tools/localstack","verify"],240)
        result=json.loads(raw)
        result.update({"source_base":BASE,"image_id":API,"postgres_image":PG,"toolchain_image":GO,"schema_check":schema_result.strip(),"bootstrap":seed.strip(),"helper_sha256":hashes["backend/scripts/localstack/main.go"],"source_hashes_sha256":hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest(),"input_files":len(hashes),"go_fixture_unit_vet_format":"pass","helper_artifacts_sha256":{n:hashlib.sha256(d).hexdigest() for n,d in artifacts.items()},"execution":"bounded network-none shared-loopback namespace; no host ports; read-only roots/source/toolchain/store; private tmpfs; no ambient env/credentials", "scratch":str(scratch)})
        print(json.dumps(result,indent=2))
    except subprocess.CalledProcessError as err:
        print(err.stderr.decode(errors="replace")[-4000:],file=__import__('sys').stderr)
        raise
    finally:
        cleanup_containers(names)


if __name__ == "__main__":
    run()
