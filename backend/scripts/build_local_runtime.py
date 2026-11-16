"""Bounded offline compilation and COPY-only LOCAL packaging, never a production build."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import selectors
import ssl
import subprocess
import tarfile
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
GO_IMAGE = "sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61"
RUNTIME_INPUT = "sha256:f1baf33b1e06c6a7b54f6226cf758785efd2efe99a358c9f613aa906da2077f4"
BINARIES = {"signalgen-api": "api", "signalgen-admin": "admin", "signalgen-audit-catalog": "auditcatalog", "signalgen-healthcheck": "healthcheck", "signalgen-collect-idx": "collectidx"}


def call(*args, **kwargs):
    return subprocess.check_output(args, timeout=kwargs.pop("timeout", 60), **kwargs)


def inspect(ref):
    return json.loads(call("docker", "image", "inspect", ref))[0]


def review_base(image):
    config = image["Config"]
    if image["Id"] != RUNTIME_INPUT or config.get("OnBuild") or config.get("Entrypoint"):
        raise ValueError("Runtime input identity or execution hooks changed")
    if config.get("Cmd") != ["signalgen-api"] or config.get("User") != "signalgen":
        raise ValueError("Unexpected runtime input command/user")
    if {item.split("=", 1)[0] for item in config.get("Env", [])} != {"PATH"}:
        raise ValueError("Unexpected runtime input environment; values are not displayed")


def unpack_named(raw, limits):
    """Never extract paths/links from target output into the host filesystem."""
    result = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for member in archive:
            if member.name not in limits or member.name in result or not member.isfile() or not 0 < member.size <= limits[member.name]:
                raise ValueError("Unexpected artifact type/name/size")
            result[member.name] = archive.extractfile(member).read()
    if set(result) != set(limits):
        raise ValueError("Missing named artifact")
    return result


def review_recipe(text):
    if re.search(r"^\s*#\s*(syntax|escape)\s*=", text, re.MULTILINE):
        raise ValueError("External/parser frontend directives are not permitted")
    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    allowed = {"FROM", "COPY", "USER", "ENV", "EXPOSE", "HEALTHCHECK", "CMD"}
    if not lines or lines[0] != "FROM scratch" or sum(line.startswith("FROM ") for line in lines) != 1:
        raise ValueError("Only the built-in scratch base is permitted")
    if any(line.split()[0] not in allowed or "--from" in line for line in lines):
        raise ValueError("Packaging must contain no executable or remote build instruction")
    if "USER 10001:10001" not in lines or lines[-1] != 'CMD ["signalgen-api"]':
        raise ValueError("Runtime identity/command changed")
    if [line for line in lines if line.startswith("ENV ")] != ["ENV PATH=/usr/local/bin HOME=/scratch/home TMPDIR=/scratch/tmp"]:
        raise ValueError("Runtime environment must remain the explicit safe allowlist")


def run_bounded(image, args, mounts=(), seconds=60, compile=False):
    name = "signalgen-local-verify-" + uuid.uuid4().hex[:12]
    command = ["docker", "run", "--rm", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--cpus", "2", "--memory", "2g", "--pids-limit", "256", "--ulimit", "nofile=1024:1024", "--ulimit", "fsize=134217728:134217728", "--tmpfs", "/scratch:rw,exec,size=2147483648,mode=0700,uid=" + ("65534,gid=65534" if compile else "10001,gid=10001"), "--user", "65534:65534" if compile else "10001:10001", "--no-healthcheck"]
    for source, target in mounts:
        command += ["--mount", f"type=bind,src={source},dst={target},readonly"]
    if compile:
        command += ["-w", "/target", "--entrypoint", "/usr/bin/env", image, "-i", "PATH=/usr/local/go/bin:/usr/bin:/bin", "HOME=/scratch/home", "TMPDIR=/scratch/tmp", "GOCACHE=/scratch/cache", "GOMODCACHE=/gomod", "GOPROXY=off", "GOSUMDB=off", "GOTOOLCHAIN=local", "CGO_ENABLED=0", "timeout", str(seconds), "/bin/sh", "-c", args]
    else:
        command += ["--env", "PATH=/usr/local/bin", "--env", "HOME=/scratch/home", "--env", "TMPDIR=/scratch", "--env", "SIGNALGEN_TEST_COLLECTOR_BINARY=/usr/local/bin/signalgen-collect-idx", "--entrypoint", args[0], image, *args[1:]]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        streams = selectors.DefaultSelector()
        streams.register(process.stdout, selectors.EVENT_READ, 0)
        streams.register(process.stderr, selectors.EVENT_READ, 1)
        buffers = [bytearray(), bytearray()]
        deadline = time.monotonic() + seconds + 15
        while streams.get_map():
            if time.monotonic() >= deadline:
                raise TimeoutError("Bounded container deadline exceeded")
            for key, _ in streams.select(timeout=1):
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    streams.unregister(key.fileobj)
                    continue
                buffers[key.data].extend(chunk)
                if len(buffers[key.data]) > [256 * 1024 * 1024, 1024 * 1024][key.data]:
                    raise ValueError("Bounded container output exceeded limit")
        process.wait(timeout=5)
        return process.returncode, bytes(buffers[0]), bytes(buffers[1])
    except BaseException:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        process.kill()
        process.communicate()
        raise


def main():
    os.chdir(ROOT)
    recipe = ROOT / "backend/LocalRuntime.Dockerfile"
    recipe_bytes = recipe.read_bytes()
    review_recipe(recipe_bytes.decode())
    source = call("git", "rev-parse", "HEAD").decode().strip()
    paths = call("git", "ls-files", "backend/cmd", "backend/core", "backend/internal", "backend/contracts", "backend/go.mod", "backend/go.sum", "backend/contract.go", "backend/openapi.yaml").decode().splitlines()
    hashes = {}
    for path in paths:
        candidate = Path(path)
        if candidate.is_symlink() or not candidate.is_file() or candidate.stat().st_size > 16*1024*1024:
            raise ValueError("Invalid protected source input")
        content = candidate.read_bytes()
        if content != call("git", "show", source + ":" + path):
            raise ValueError("Dirty protected source: " + path)
        hashes[path] = hashlib.sha256(content).hexdigest()
    base = inspect(RUNTIME_INPUT)
    review_base(base)
    if inspect(GO_IMAGE)["Id"] != GO_IMAGE:
        raise ValueError("Toolchain identity changed")
    scratch = Path(tempfile.mkdtemp(prefix="signalgen-local-runtime-"))
    scratch.chmod(0o700)
    context = scratch / "context"
    for name in ["bin", "runtime/ssl/certs", "fixtures", "licenses", "tools"]:
        (context / name).mkdir(parents=True)
    # Copy only the reviewed tracked compiler inputs; never mount a personal .env.
    source_copy = scratch / "source"
    total = 0
    for path in paths:
        src = ROOT / path
        total += src.stat().st_size
        if src.is_symlink() or not src.is_file() or src.stat().st_size > 16*1024*1024 or total > 64*1024*1024:
            raise ValueError("Invalid or oversized source input")
        dest = source_copy / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        content = src.read_bytes()
        if hashlib.sha256(content).hexdigest() != hashes[path]:
            raise ValueError("Source changed during snapshot: " + path)
        dest.write_bytes(content)
        dest.chmod(0o444)
    # Parent-only copies from a stopped container; no old program is executed.
    container = call("docker", "create", RUNTIME_INPUT).decode().strip()
    try:
        for src, dest, limit in [("/etc/ssl/certs/ca-certificates.crt", "ssl/certs/ca-certificates.crt", 1024*1024), ("/etc/passwd", "passwd", 65536), ("/etc/group", "group", 65536)]:
            raw = call("docker", "cp", container + ":" + src, "-")
            data = unpack_named(raw, {Path(src).name: limit})[Path(src).name]
            (context / "runtime" / dest).write_bytes(data)
    finally:
        call("docker", "rm", container)
    passwd = (context / "runtime/passwd").read_text()
    if not any(row.split(":")[0] == "signalgen" and row.split(":")[2] == "10001" for row in passwd.splitlines()):
        raise ValueError("Expected non-root identity missing")
    ssl.create_default_context(cafile=str(context / "runtime/ssl/certs/ca-certificates.crt"))
    module_cache = call("go", "env", "GOMODCACHE").decode().strip()
    build = "mkdir -p /scratch/home /scratch/tmp /scratch/cache /scratch/out && " + " && ".join(f"go build -buildvcs=false -trimpath -ldflags='-s -w' -o /scratch/out/{name} ./cmd/{package}" for name, package in BINARIES.items())
    build += " && go test -c -o /scratch/out/collection.test ./internal/collection && tar -C /scratch/out -cf - " + " ".join([*BINARIES, "collection.test"])
    code, raw, err = run_bounded(GO_IMAGE, build, [(source_copy / "backend", "/target"), (module_cache, "/gomod")], seconds=360, compile=True)
    if code:
        raise RuntimeError(err.decode())
    artifacts = unpack_named(raw, {name: 64*1024*1024 for name in [*BINARIES, "collection.test"]})
    for name, content in artifacts.items():
        if not content.startswith(b"\x7fELF"):
            raise ValueError("Non-ELF artifact: " + name)
        dest = context / ("bin" if name in BINARIES else "tools") / name
        dest.write_bytes(content)
        dest.chmod(0o555)
    for src, dest in [(source_copy / "backend/core/testdata/default_scalping_v1.json", context / "fixtures/default_scalping_v1.json"), (source_copy / "backend/core/licenses/TA-Lib.txt", context / "licenses/TA-Lib.txt")]:
        if src.is_symlink() or not src.is_file() or src.stat().st_size > 1024*1024:
            raise ValueError("Invalid fixture/license input")
        dest.write_bytes(src.read_bytes())
        dest.chmod(0o444)
    tag = "signalgen-local-runtime:" + source[:12]
    (context / "LocalRuntime.Dockerfile").write_bytes(recipe_bytes)
    call("docker", "build", "--network", "none", "--pull=false", "--tag", tag, "--label", "org.opencontainers.image.revision=" + source, "--label", "signalgen.local.runtime-input=" + RUNTIME_INPUT, "--file", str(context / "LocalRuntime.Dockerfile"), str(context), timeout=120)
    final = inspect(tag)
    if final["Config"].get("User") != "10001:10001" or final["Config"].get("Entrypoint") or final["Config"].get("OnBuild"):
        raise ValueError("Final runtime identity/hooks changed")
    container = call("docker", "create", final["Id"]).decode().strip()
    try:
        for name in BINARIES:
            archive_bytes = call("docker", "cp", container + ":/usr/local/bin/" + name, "-")
            with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as archive:
                member = archive.getmembers()[0]
                if member.uid != 0 or member.gid != 0 or member.mode != 0o555:
                    raise ValueError("Packaged executable ownership/mode changed")
            packed = unpack_named(archive_bytes, {name: 64*1024*1024})[name]
            if packed != artifacts[name]:
                raise ValueError("Packaged binary does not match rebuilt artifact: " + name)
    finally:
        call("docker", "rm", container)
    code, help_out, err = run_bounded(final["Id"], ["/usr/local/bin/signalgen-collect-idx", "-h"])
    if code or b"incremental" not in err + help_out:
        raise RuntimeError("Packaged collector help failed")
    # Static test binary invokes the actual packaged collector and synthetic library fixtures.
    code, smoke, err = run_bounded(final["Id"], ["/smoke/collection.test", "-test.run", "^TestCollectorRuntimeSmoke$", "-test.v"], [(context / "tools", "/smoke")], seconds=60)
    if code:
        raise RuntimeError((smoke + err).decode())
    code, out, err = run_bounded(final["Id"], ["/usr/local/bin/signalgen-collect-idx", "-out", "/usr/local/bin", "-prune-only", "-retention-dry-run"])
    if code == 0 or b"read-only" not in err.lower():
        raise RuntimeError("Read-only root failure was not enforced")
    readonly_error = err.decode()
    catalog = scratch / "synthetic-catalog"
    catalog.mkdir()
    (catalog / "idx.csv").write_text("Kode,Nama Perusahaan,Tanggal Pencatatan\nBBCA,Synthetic bank,31 Mei 2000\n")
    (catalog / "idx.csv").chmod(0o444)
    code, out, err = run_bounded(final["Id"], ["/usr/local/bin/signalgen-collect-idx", "-catalog", "/catalog/idx.csv", "-as-of", "2026-01-20", "-validate-only"], [(catalog, "/catalog")])
    if code or b"Validation only" not in out:
        raise RuntimeError("Read-only synthetic catalog validation failed")
    code, out, err = run_bounded(final["Id"], ["/usr/local/bin/signalgen-collect-idx", "-out", "/catalog", "-prune-only"], [(catalog, "/catalog")])
    if code == 0 or b"read-only" not in err.lower():
        raise RuntimeError("Read-only catalog mount failure was not enforced")
    code, out, err = run_bounded(final["Id"], ["/usr/local/bin/signalgen-collect-idx", "-h"], [(scratch / "must-not-exist", "/absent")])
    if code == 0 or b"does not exist" not in err:
        raise RuntimeError("Missing bind source was not rejected")
    empty = scratch / "empty.env"
    empty.write_text("")
    store = scratch / "private-store"
    store.mkdir(mode=0o700)
    compose_env = {"PATH": os.environ["PATH"], "HOME": str(Path.home()), "SIGNALGEN_LOCAL_IMAGE": final["Id"], "SIGNALGEN_LOCAL_API_ENV_FILE": str(empty), "SIGNALGEN_LOCAL_IDX_STORE": str(store), "SIGNALGEN_LOCAL_IDX_CATALOG": str(catalog / "idx.csv")}
    config = json.loads(call("docker", "compose", "--env-file", str(empty), "--profile", "collector", "-f", str(ROOT / "docker-compose.local-runtime.yml"), "config", "--format", "json", env=compose_env))
    api, collector = config["services"]["go-api"], config["services"]["collector"]
    if api["environment"]["SIGNALGEN_MARKET_DATA_MODE"] != "idx_store" or not api["read_only"] or not api["volumes"][0]["read_only"] or collector["network_mode"] != "none" or collector["volumes"][0]["read_only"] is not True or collector["volumes"][1].get("read_only", False):
        raise ValueError("Local compose publication/mount boundaries changed")
    report = {"source_sha": source, "source_files": hashes, "runtime_input_id": RUNTIME_INPUT, "toolchain_id": GO_IMAGE, "image_id": final["Id"], "tag": tag, "scratch": str(scratch), "artifacts_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in artifacts.items()}, "smoke": smoke.decode(), "readonly_root_rejection": readonly_error, "checks": ["all five packaged binaries byte-match rebuilt artifacts", "non-root runtime", "read-only synthetic catalog", "read-only root and catalog writes rejected", "missing bind source rejected", "compose config with empty env file and synthetic inputs"], "base_config_review": {"onbuild": None, "entrypoint": None, "cmd": ["signalgen-api"], "user": "signalgen", "env_names": ["PATH"]}, "full_api_started": False, "original_dockerfile_built": False}
    report["runtime_inputs_sha256"] = {str(path.relative_to(context)): hashlib.sha256(path.read_bytes()).hexdigest() for directory in ["runtime", "fixtures", "licenses"] for path in (context / directory).rglob("*") if path.is_file()}
    report["recipe_sha256"] = hashlib.sha256(recipe_bytes).hexdigest()
    report["compose_sha256"] = hashlib.sha256((ROOT / "docker-compose.local-runtime.yml").read_bytes()).hexdigest()
    (scratch / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "source_files"}, indent=2))


if __name__ == "__main__":
    main()
