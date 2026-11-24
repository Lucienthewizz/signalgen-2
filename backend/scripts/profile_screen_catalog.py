#!/usr/bin/env python3
"""Bounded offline profile of a whole-market screen or signal study.

Builds and runs TestScreenRealCatalogTiming (native Go HTTP harness; it does
not measure browser Worker/WASM/IndexedDB) against a pinned, read-only IDX archive
copy. Target code only runs in containers with no network, a read-only root,
read-only source/deps/archive mounts, a size-capped tmpfs as the only writable
path, a non-root user, all capabilities dropped and CPU/RAM/PID/file/wall caps.
Artifacts leave the container as a tar on stdout and are promoted by this
script only if they are allowlisted regular files within byte limits.

Usage, from the repository root:
  SCREEN_STORE=<store with a pinned generation or a completed flat collection>
  SCREEN_CATALOG=<962-item catalog.json> SCREEN_OUT=<new or empty dir outside the repo>
  [SCREEN_REPORT_SHA256=<expected report.json sha256>] [GOMODCACHE_HOST=~/go/pkg/mod]
  [SCREEN_PROFILE=paired]
  python3 -I backend/scripts/profile_screen_catalog.py
Never point SCREEN_STORE at a live store the scheduler is updating.
"""

import hashlib
import io
import json
import os
import secrets
import subprocess
import sys
import tarfile
from pathlib import Path

GO_IMAGE = "golang@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61"
DOCKER_CONTEXT = "orbstack"
PLATFORM = "linux/arm64"
BUILD_SECONDS, RUN_SECONDS = 600, 1500
# Artifact allowlist: name -> max bytes.
BUILD_FILES = {"apitests.test": 128 << 20}
RUN_FILES = {"timing.json": 8 << 20, "oracle.json": 64 << 20, "cpu.pprof": 32 << 20, "log.txt": 8 << 20}
SCENARIOS = [  # name, from, to, runs, rtt
    ("short", "2026-11-13", "2026-11-13", 3, "0s"),  # UI default: one signal day
    ("year", "2025-11-14", "2026-11-13", 3, "0s"),  # largest allowed window
    ("short-rtt20", "2026-11-13", "2026-11-13", 1, "20ms"),
    ("short-rtt80", "2026-11-13", "2026-11-13", 1, "80ms"),
    ("year-rtt80", "2025-11-14", "2026-11-13", 1, "80ms"),
]


def docker_env():
    # The docker CLI gets PATH and HOME (for its context config) only.
    return {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "HOME": os.environ["HOME"]}


def docker_argv(name, mounts, env, command, scratch_mb):
    """mounts: list of (host, container) bound read-only. env: container variables."""
    argv = ["docker", "--context", DOCKER_CONTEXT, "run", "--rm", "--pull=never", "--platform", PLATFORM,
            "--name", name, "--network", "none", "--read-only", "--user", "65532:65532",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--cpus", "2", "--memory", "3g", "--memory-swap", "3g", "--pids-limit", "256",
            "--ulimit", "nofile=4096:4096", "--ulimit", "fsize=268435456:268435456",
            "--tmpfs", f"/scratch:rw,exec,size={scratch_mb}m,mode=1777", "--workdir", "/scratch"]
    for key, value in {"HOME": "/scratch", "TMPDIR": "/scratch", **env}.items():
        argv += ["-e", f"{key}={value}"]
    for host, target in mounts:
        argv += ["--mount", f"type=bind,src={host},dst={target},readonly"]
    return argv + [GO_IMAGE] + command


def promote(tar_bytes, allowed, dest):
    """Copy allowlisted regular files from an untrusted tar into dest (exclusive create)."""
    dest.mkdir(parents=True, exist_ok=True)
    total, written = 0, []
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:") as archive:
        for member in archive.getmembers():
            name = member.name.removeprefix("./")
            if name in ("", "."):
                continue
            if name not in allowed or "/" in name or not member.isreg() or member.size > allowed[name]:
                raise ValueError(f"artifact rejected: {member.name!r}")
            data = archive.extractfile(member).read(allowed[name] + 1)
            if len(data) != member.size:
                raise ValueError(f"artifact size changed: {name}")
            total += len(data)
            with open(dest / name, "xb") as out:  # never follows or overwrites
                out.write(data)
            written.append(name)
    return written, total


def contained(name, argv, seconds, limit):
    """Run one container; return stdout bounded to limit bytes. Removes only its own container."""
    try:
        done = subprocess.run(argv, env=docker_env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=seconds + 60)
    except subprocess.TimeoutExpired:
        subprocess.run(["docker", "--context", DOCKER_CONTEXT, "rm", "-f", name], env=docker_env(), capture_output=True, timeout=60)
        raise
    if len(done.stdout) > limit:
        raise ValueError(f"{name}: artifact stream exceeds {limit} bytes")
    if done.returncode != 0:
        sys.stderr.write(done.stderr.decode(errors="replace")[-4000:])
    return done.returncode, done.stdout


def main():
    store, catalog, out = (Path(os.environ[k]).resolve() for k in ("SCREEN_STORE", "SCREEN_CATALOG", "SCREEN_OUT"))
    repo = Path.cwd().resolve()
    if not (repo / "backend/go.mod").is_file():
        sys.exit("run from the repository root")
    if out.is_relative_to(repo) or (out.exists() and any(out.iterdir())):
        sys.exit("SCREEN_OUT must be a new or empty directory outside the repository")
    mode = os.environ.get("SCREEN_PROFILE", "screen")
    if mode not in ("screen", "paired"):
        sys.exit("SCREEN_PROFILE must be screen or paired")
    pointer = store / "current.json"
    generation = json.loads(pointer.read_text())["generation"] if pointer.is_file() else None
    if generation is not None and ("/" in generation or not generation.startswith("generation-")):
        sys.exit("invalid generation pointer")
    report_path = (store / generation if generation else store) / "report.json"
    report_bytes = report_path.read_bytes()
    report_sha = hashlib.sha256(report_bytes).hexdigest()
    catalog_sha = hashlib.sha256(catalog.read_bytes()).hexdigest()
    report = json.loads(report_bytes)
    if generation is None and report["catalog_sha256"] != catalog_sha:
        sys.exit("flat archive and benchmark catalog have different hashes")
    expected = os.environ.get("SCREEN_REPORT_SHA256")
    if expected and report_sha != expected:
        sys.exit(f"report.json sha256 {report_sha} does not match pin")
    mods = Path(os.environ.get("GOMODCACHE_HOST", Path.home() / "go/pkg/mod")).resolve()
    tag = secrets.token_hex(4)
    print(f"generation={generation or 'flat'} report_sha256={report_sha}", flush=True)

    name = f"sg-screen-build-{tag}"
    build = docker_argv(name, [(repo / "backend", "/src"), (mods, "/gomod")],
                        {"GOFLAGS": "-mod=mod", "GOPROXY": "off", "GOTOOLCHAIN": "local", "GOCACHE": "/scratch/gocache",
                         "GOMODCACHE": "/gomod", "CGO_ENABLED": "0"},
                        ["sh", "-c", f"cd /src && timeout {BUILD_SECONDS} go test -c -o /scratch/apitests.test ./internal/api/tests/ >&2 "
                         "&& tar -C /scratch -cf - apitests.test"], 1024)
    code, stream = contained(name, build, BUILD_SECONDS, 160 << 20)
    if code != 0:
        sys.exit("build failed")
    promote(stream, BUILD_FILES, out / "bin")
    binary = out / "bin/apitests.test"
    binary.chmod(0o555)

    failed = False
    scenarios = [(name, start, end, runs, rtt, "screen", "default-scalping-v1")
                 for name, start, end, runs, rtt in SCENARIOS]
    if mode == "paired":
        scenarios = [(purpose, "2026-11-13", "2026-11-13", 2, "0s", purpose, "qa-mixed-and-or")
                     for purpose in ("screen", "backtest")]
    timings = {}
    for scenario, start, end, runs, rtt, purpose, rule in scenarios:
        name = f"sg-screen-{scenario}-{tag}"
        env = {"SIGNALGEN_SCREEN_STORE": "/store", "SIGNALGEN_SCREEN_CATALOG": "/catalog.json", "SIGNALGEN_SCREEN_EXPECT_TOTAL": "962",
               "SIGNALGEN_SCREEN_FROM": start, "SIGNALGEN_SCREEN_TO": end, "SIGNALGEN_SCREEN_RUNS": str(runs), "SIGNALGEN_SCREEN_RTT": rtt,
               "SIGNALGEN_SCREEN_PURPOSE": purpose, "SIGNALGEN_SCREEN_RULE": rule,
               "SIGNALGEN_SCREEN_OUT": "/scratch/timing.json", "SIGNALGEN_SCREEN_ORACLE_OUT": "/scratch/oracle.json"}
        command = ["sh", "-c", f"timeout {RUN_SECONDS} /apitests.test -test.run '^TestScreenRealCatalogTiming$' -test.v -test.timeout 25m "
                   "-test.cpuprofile /scratch/cpu.pprof >/scratch/log.txt 2>&1; s=$?; "
                   "tar -C /scratch -cf - $(cd /scratch && ls timing.json oracle.json cpu.pprof log.txt 2>/dev/null); exit $s"]
        argv = docker_argv(name, [(store, "/store"), (catalog, "/catalog.json"), (binary, "/apitests.test")], env, command, 256)
        code, stream = contained(name, argv, RUN_SECONDS, 128 << 20)
        promote(stream, RUN_FILES, out / scenario)
        for line in (out / scenario / "log.txt").read_text().splitlines():
            if "run=" in line or line.startswith(("PASS", "FAIL", "---")):
                print(f"{scenario}: {line.strip()}", flush=True)
        if code == 0:
            timings[scenario] = json.loads((out / scenario / "timing.json").read_text())
        failed |= code != 0
    if mode == "paired" and not failed:
        counts = {status: sum(row["status"] == status for row in report["entries"])
                  for status in ("success", "failed", "pending")}
        with (out / "comparison.json").open("x") as f:
            json.dump({"base": "native Go over loopback HTTP and frozen IDX archive",
                       "catalog_sha256": catalog_sha, "report_sha256": report_sha,
                       "archive_coverage": counts, "profiles": timings}, f, indent=2)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
