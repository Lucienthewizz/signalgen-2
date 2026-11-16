#!/usr/bin/env python3
"""Reproduce adaptive-study browser evidence in bounded offline containers.

The parent snapshots only tracked regular files, mounts that snapshot and the
approved dependency/WASM inputs read-only, and writes only bounded named JSON
results after validating a stdout marker.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

IMAGE = "sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197"
DOCKER = ("docker", "--context", "orbstack")
CASE_TIMEOUT = 240
OVERALL_TIMEOUT = 1800
MAX_RESULT_BYTES = 2_000_000
SOURCE_EXCLUDES = (
    ".env",
    ".env.",
    "node_modules",
    ".git",
    "credentials",
    "secrets",
)
RESULT_MARKER = "__SIGNALGEN_RESULT__\n"


def run_checked(args: list[str], *, timeout: int = 30) -> str:
    return subprocess.check_output(
        args, text=True, stderr=subprocess.STDOUT, timeout=timeout
    )


def inspect_runtime() -> None:
    version = run_checked([*DOCKER, "version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"])
    if version.strip() != "linux/arm64":
        raise RuntimeError(f"Expected orbstack linux/arm64, got {version.strip()!r}")
    raw = run_checked([*DOCKER, "image", "inspect", IMAGE])
    info = json.loads(raw)[0]
    if info.get("Os") != "linux" or info.get("Architecture") != "arm64":
        raise RuntimeError(
            f"Pinned image is not linux/arm64: {info.get('Os')}/{info.get('Architecture')}"
        )


def tracked_snapshot(root: pathlib.Path, destination: pathlib.Path) -> dict[str, str]:
    listing = subprocess.check_output(
        ["git", "-C", str(root), "ls-files", "-z"], text=False
    ).split(b"\0")
    hashes: dict[str, str] = {}
    for raw in listing:
        if not raw:
            continue
        relative = raw.decode()
        parts = pathlib.PurePosixPath(relative).parts
        if any(
            part == item
            or part.startswith(item + ".")
            or part.startswith(item + "_")
            or (item == ".env" and part.startswith(".env."))
            for part in parts
            for item in SOURCE_EXCLUDES
        ):
            continue
        source = root / relative
        if source.is_symlink() or not source.is_file():
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        hashes[relative] = digest
    return hashes


def validate_inputs(deps: pathlib.Path, wasm: pathlib.Path) -> None:
    if deps.is_symlink() or not deps.is_dir():
        raise ValueError(f"Dependency input must be a real directory: {deps}")
    for name in ("signalgen_core.wasm", "wasm_exec.js", "signalgen_core.manifest.json"):
        path = wasm / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing regular WASM input: {path}")
        if path.stat().st_size > 200 * 1024 * 1024:
            raise ValueError(f"WASM input exceeds bounded size: {path}")


def docker_args(
    name: str,
    snapshot: pathlib.Path,
    deps: pathlib.Path,
    wasm: pathlib.Path,
    workers: int,
    candles: int,
    operands: int,
) -> list[str]:
    command = r"""
set -eu
mkdir -p /scratch/repo /scratch/repo/frontend/web/public/wasm
cp -a /source/. /scratch/repo/
cp /wasm/* /scratch/repo/frontend/web/public/wasm/
ln -s /toolchain/node_modules /scratch/repo/frontend/web/node_modules
cat >/scratch/vite.config.ts <<'EOF'
import config from "/scratch/repo/frontend/web/vite.config.ts";
export default {...config, root:"/scratch/repo/frontend/web", cacheDir:"/scratch/vite-cache"};
EOF
cd /scratch/repo/frontend/web
/toolchain/node_modules/.bin/vite --config /scratch/vite.config.ts --host 127.0.0.1 --port 5174 >/scratch/vite.log 2>&1 &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT
node -e 'let n=0;(async()=>{for(;n<100;n++){try{if((await fetch("http://127.0.0.1:5174/ready")).ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,100))}process.exit(1)})()'
SIGNALGEN_TEST_BASE_URL="http://127.0.0.1:5174/?workers=${WORKERS}&candles=${CANDLES}&operands=${OPERANDS}" NODE_PATH=/toolchain/node_modules node scripts/test-browser.mjs --study
result=/scratch/repo/frontend/web/output/playwright/signal-study-browser.json
test -s "$result"
test "$(wc -c <"$result")" -le 2000000
printf '__SIGNALGEN_RESULT__\n'
cat "$result"
"""
    return [
        *DOCKER,
        "run",
        "--pull=never",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        "1000:1000",
        "--cpus",
        "2",
        "--memory",
        "3g",
        "--pids-limit",
        "512",
        "--ulimit",
        "fsize=209715200:209715200",
        "--tmpfs",
        "/scratch:rw,exec,size=3g,mode=0700,uid=1000,gid=1000",
        "-v",
        f"{snapshot}:/source:ro",
        "-v",
        f"{deps}:/toolchain/node_modules:ro",
        "-v",
        f"{wasm}:/wasm:ro",
        IMAGE,
        "/usr/bin/env",
        "-i",
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "HOME=/scratch/home",
        "TMPDIR=/scratch/tmp",
        "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
        f"WORKERS={workers}",
        f"CANDLES={candles}",
        f"OPERANDS={operands}",
        "/bin/sh",
        "-ec",
        command,
    ]


def cleanup(names: list[str]) -> None:
    failures: list[str] = []
    for name in names:
        try:
            subprocess.run(
                [*DOCKER, "rm", "-f", name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=20,
                check=True,
            )
        except Exception as error:  # cleanup must continue for every owned name
            failures.append(f"{name}: {error}")
    if failures:
        raise RuntimeError("Owned container cleanup incomplete: " + "; ".join(failures))


def run_case(
    root: pathlib.Path,
    snapshot: pathlib.Path,
    deps: pathlib.Path,
    wasm: pathlib.Path,
    output: pathlib.Path,
    workers: int,
    candles: int,
    operands: int,
    label: str,
    owned: list[str],
    deadline: float,
) -> None:
    name = f"signalgen-adaptive-{os.getpid()}-{label}-{uuid.uuid4().hex[:8]}"
    owned.append(name)
    args = docker_args(name, snapshot, deps, wasm, workers, candles, operands)
    env = os.environ.copy()
    env.update({"WORKERS": str(workers), "CANDLES": str(candles), "OPERANDS": str(operands)})
    remaining = max(1, min(CASE_TIMEOUT, int(deadline - time.monotonic())))
    try:
        completed = subprocess.run(
            args,
            env=env,
            capture_output=True,
            text=True,
            timeout=remaining,
        )
        if completed.returncode:
            detail = (completed.stdout + "\n" + completed.stderr)[-4000:]
            raise RuntimeError(f"{label}: container exited {completed.returncode}\n{detail}")
        if RESULT_MARKER not in completed.stdout:
            raise RuntimeError(f"{label}: bounded result marker missing")
        payload = completed.stdout.split(RESULT_MARKER, 1)[1].encode()
        if len(payload) > MAX_RESULT_BYTES:
            raise RuntimeError(f"{label}: bounded result exceeded {MAX_RESULT_BYTES} bytes")
        result = json.loads(payload)
        output.mkdir(parents=True, exist_ok=True)
        (output / f"{label}.json").write_text(json.dumps(result, indent=2) + "\n")
    except subprocess.TimeoutExpired as error:
        try:
            subprocess.run([*DOCKER, "kill", name], timeout=20, check=False)
        finally:
            raise TimeoutError(f"{label}: container deadline exceeded") from error


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deps", type=pathlib.Path, required=True)
    parser.add_argument("--wasm", type=pathlib.Path, required=True)
    parser.add_argument("--evidence", type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    validate_inputs(args.deps, args.wasm)
    inspect_runtime()
    owned: list[str] = []
    deadline = time.monotonic() + OVERALL_TIMEOUT
    try:
        with tempfile.TemporaryDirectory(prefix="signalgen-study-source-") as temp:
            snapshot = pathlib.Path(temp) / "source"
            snapshot.mkdir()
            source_hashes = tracked_snapshot(root, snapshot)
            (args.evidence / "source-hashes.json").parent.mkdir(parents=True, exist_ok=True)
            (args.evidence / "source-hashes.json").write_text(
                json.dumps({"files": source_hashes}, indent=2) + "\n"
            )
            cases = (
                (4, 250, 3, "small-adaptive-1"),
                (1, 250, 3, "small-baseline-1"),
            )
            for case in cases:
                run_case(root, snapshot, args.deps, args.wasm, args.evidence, *case, owned, deadline)
            comparator = root / "frontend/web/tests/browser/compare-signal-study-evidence.mjs"
            for adaptive, baseline in (
                ("small-adaptive-1", "small-baseline-1"),
            ):
                subprocess.run(
                    [
                        "node",
                        str(comparator),
                        str(args.evidence / f"{adaptive}.json"),
                        str(args.evidence / f"{baseline}.json"),
                    ],
                    check=True,
                    timeout=30,
                )
    finally:
        cleanup(owned)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
