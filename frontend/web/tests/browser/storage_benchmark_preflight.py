#!/usr/bin/env python3
"""Reusable offline preflight and bounded-process helpers for the storage runner."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def validate_image_inspect(raw, expected_id, expected_platform):
    images = json.loads(raw)
    if not isinstance(images, list) or len(images) != 1:
        raise ValueError("Expected exactly one inspected image")
    image = images[0]
    config = image.get("Config") or {}
    actual_platform = f"{image.get('Os')}/{image.get('Architecture')}"
    if (
        image.get("Id") != expected_id
        or actual_platform != expected_platform
        or config.get("Entrypoint") not in (None, [])
        or config.get("OnBuild") not in (None, [])
    ):
        raise ValueError(
            "Pinned image identity/platform/hooks changed: "
            f"id={image.get('Id')} platform={actual_platform} "
            f"entrypoint={config.get('Entrypoint')} onbuild={config.get('OnBuild')}"
        )
    return {"id": image["Id"], "platform": actual_platform}


def validate_dependency_tree(node_modules, package_lock):
    node_modules = Path(node_modules)
    package_lock = Path(package_lock)
    lock_copy = node_modules / ".package-lock.json"
    if (
        not node_modules.is_dir()
        or node_modules.is_symlink()
        or not lock_copy.is_file()
        or lock_copy.is_symlink()
        or not package_lock.is_file()
    ):
        raise ValueError("Dependency inputs must be real directories/files with lockfiles")
    package_data = json.loads(package_lock.read_text())
    copy_data = json.loads(lock_copy.read_text())
    if package_data.get("lockfileVersion") != copy_data.get("lockfileVersion"):
        raise ValueError("Dependency lockfile versions do not match")
    return {
        "package_lock_sha256": hashlib.sha256(package_lock.read_bytes()).hexdigest(),
        "node_modules_lock_sha256": hashlib.sha256(lock_copy.read_bytes()).hexdigest(),
        "lockfile_version": package_data.get("lockfileVersion"),
    }


def validate_source_files(root, relative_paths, max_file_size=16 * 1024 * 1024):
    root = Path(root)
    result = {}
    for relative in relative_paths:
        path = root / relative
        if (
            path.is_symlink()
            or not path.is_file()
            or path.suffix not in {".ts", ".mjs", ".json"}
            or path.stat().st_size > max_file_size
        ):
            raise ValueError(f"Unsafe benchmark source input: {relative}")
        result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def run_bounded(command, timeout_seconds):
    try:
        return subprocess.run(command, check=False, timeout=timeout_seconds).returncode
    except subprocess.TimeoutExpired:
        print(f"Host deadline exceeded after {timeout_seconds}s", file=sys.stderr)
        return 124


def main(argv=None):
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    image = subparsers.add_parser("image")
    image.add_argument("--expected-id", required=True)
    image.add_argument("--expected-platform", required=True)
    deps = subparsers.add_parser("deps")
    deps.add_argument("--node-modules", required=True)
    deps.add_argument("--package-lock", required=True)
    sources = subparsers.add_parser("sources")
    sources.add_argument("--root", required=True)
    sources.add_argument("paths", nargs="+")
    bounded = subparsers.add_parser("run")
    bounded.add_argument("--timeout", type=float, required=True)
    bounded.add_argument("argv", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.command == "image":
        print(json.dumps(validate_image_inspect(sys.stdin.read(), args.expected_id, args.expected_platform)))
    elif args.command == "deps":
        print(json.dumps(validate_dependency_tree(args.node_modules, args.package_lock)))
    elif args.command == "sources":
        print(json.dumps(validate_source_files(args.root, args.paths), sort_keys=True))
    else:
        command = args.argv[1:] if args.argv[:1] == ["--"] else args.argv
        if not command:
            parser.error("run requires a command")
        raise SystemExit(run_bounded(command, args.timeout))


if __name__ == "__main__":
    main()
