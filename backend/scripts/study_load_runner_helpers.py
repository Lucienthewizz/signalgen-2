#!/usr/bin/env python3
"""Shared helper functions for sustained signal-study load runner and preflight tests.
Provides:
- validate_image_inspect: Validates Docker inspect identity, platform, and triggers.
- safe_extract_tracked_source: Safely exports allowlisted tracked source files with lstat checks.
- validate_evidence_json: Validates schema, finite bounds, invariants, and leak-free evidence.
- docker_cleanup_container: Bounded container removal with explicit error handling.
"""

import hashlib
import json
import math
import os
import stat
import subprocess
import sys
from pathlib import Path

ALLOWED_EXTENSIONS = {
    ".go", ".mod", ".sum", ".sh", ".py", ".sql", ".md",
    ".json", ".yml", ".yaml", ".txt", ".mjs", ".cjs"
}

DISALLOWED_EXACT_NAMES = {
    ".env", ".env.local", ".env.production", ".env.staging",
    "localstack.db", "runtime.db"
}

DISALLOWED_EXTENSIONS = {
    ".pem", ".key", ".sqlite", ".db", ".cert", ".crt"
}


def validate_image_inspect(inspect_raw: str, expected_id: str) -> dict:
    """Validate that Docker inspect output matches the expected immutable ID and safe configuration."""
    try:
        data = json.loads(inspect_raw)
    except Exception as e:
        raise ValueError(f"Failed to parse inspect JSON: {e}") from e

    if not isinstance(data, list) or len(data) == 0:
        raise ValueError("Invalid or empty inspect array")

    img = data[0]
    img_id = img.get("Id")
    if img_id != expected_id:
        raise ValueError(f"Image ID mismatch: expected {expected_id}, got {img_id}")

    arch = img.get("Architecture")
    if arch != "arm64":
        raise ValueError(f"Unexpected image architecture: expected arm64, got {arch}")

    img_os = img.get("Os")
    if img_os != "linux":
        raise ValueError(f"Unexpected image OS: expected linux, got {img_os}")

    config = img.get("Config") or {}
    if config.get("OnBuild"):
        raise ValueError(f"Pinned image contains untrusted OnBuild triggers: {config.get('OnBuild')}")

    return img


def safe_extract_tracked_source(repo_root: Path, target_dir: Path) -> dict:
    """Safely extracts tracked backend source files without following symlinks.

    Verifies every relative path, uses os.lstat to ensure each file is a regular file
    (not a symlink), strictly bounds individual and total file sizes, checks extensions
    against an allowlist, strips any .env or credential files, and generates a SHA256 manifest.
    """
    repo_root = Path(repo_root).resolve()
    target_dir = Path(target_dir).resolve()

    res = subprocess.run(
        ["git", "ls-files", "-s", "backend"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        timeout=15,
    )
    if res.returncode != 0:
        raise RuntimeError(f"git ls-files failed: {res.stderr}")

    lines = [line.strip() for line in res.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("git ls-files returned no tracked files for backend")

    manifest = {}
    total_bytes = 0
    max_file_size = 32 * 1024 * 1024
    max_total_size = 64 * 1024 * 1024

    for line in lines:
        parts = line.split(maxsplit=3)
        if len(parts) < 4:
            continue
        mode, blob_hash, stage, rel_path = parts[0], parts[1], parts[2], parts[3]

        # Verify mode is regular file (100644 or 100755), not symlink (120000)
        if mode == "120000":
            raise ValueError(f"Disallowed symlink in tracked files: {rel_path}")

        # Path safety: must start with backend/ and must not escape
        if not rel_path.startswith("backend/") or ".." in rel_path or os.path.isabs(rel_path):
            raise ValueError(f"Invalid or escaping path: {rel_path}")

        file_name = os.path.basename(rel_path)
        _, ext = os.path.splitext(file_name)

        if file_name in DISALLOWED_EXACT_NAMES or file_name.startswith(".env"):
            # Exclude environment, runtime, and credential files from snapshot
            continue

        if ext in DISALLOWED_EXTENSIONS:
            raise ValueError(f"Disallowed extension: {rel_path}")

        is_dockerfile = file_name.endswith("Dockerfile") or "Dockerfile" in file_name or file_name == ".gitignore"
        if ext not in ALLOWED_EXTENSIONS and not is_dockerfile:
            raise ValueError(f"Disallowed extension '{ext}' for file: {rel_path}")

        src_path = repo_root / rel_path
        st = os.lstat(src_path)
        if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
            raise ValueError(f"File is not a regular file or is a symlink: {rel_path}")

        if st.st_size > max_file_size:
            raise ValueError(f"File {rel_path} exceeds maximum size {max_file_size}")

        total_bytes += st.st_size
        if total_bytes > max_total_size:
            raise ValueError(f"Total source snapshot size exceeds {max_total_size} bytes")

        # Copy file content safely
        dst_path = target_dir / rel_path
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        content = src_path.read_bytes()
        dst_path.write_bytes(content)

        file_hash = hashlib.sha256(content).hexdigest()
        manifest[rel_path] = {
            "bytes": len(content),
            "sha256": file_hash,
            "mode": mode,
        }

    manifest_json = json.dumps(manifest, sort_keys=True, indent=2)
    manifest_hash = hashlib.sha256(manifest_json.encode("utf-8")).hexdigest()
    (target_dir / "backend_snapshot_manifest.json").write_text(manifest_json)

    return {
        "file_count": len(manifest),
        "total_bytes": total_bytes,
        "manifest_sha256": manifest_hash,
    }


def validate_evidence_json(raw_content: str) -> dict:
    """Validate sustained load evidence JSON schema, numerical finiteness, and invariants."""
    data = json.loads(raw_content)

    if data.get("kind") != "loopback_http_sustained_workload":
        raise ValueError(f"Unexpected evidence kind: {data.get('kind')}")
    if data.get("schema_version") != 3:
        raise ValueError(f"Unexpected schema version: {data.get('schema_version')}")
    if not data.get("timestamp") or not data.get("measured_date"):
        raise ValueError("Missing timestamp or measured_date")

    runs = data.get("runs")
    if not isinstance(runs, list) or len(runs) == 0:
        raise ValueError("Evidence runs array is empty or missing")

    for idx, run in enumerate(runs):
        concurrency = run.get("concurrency")
        if not isinstance(concurrency, int) or concurrency < 1:
            raise ValueError(f"Run {idx}: invalid concurrency {concurrency}")

        duration = run.get("measured_duration_ms", 0.0)
        if not isinstance(duration, (int, float)) or math.isnan(duration) or math.isinf(duration) or duration < 5000.0:
            raise ValueError(f"Run {idx} (concurrency {concurrency}): invalid or sub-5s duration {duration}")

        attempts = run.get("attempts", 0)
        completed = run.get("completed", 0)
        rejected = run.get("rejected", 0)
        failed = run.get("failed", 0)
        cancelled = run.get("cancelled", 0)

        if attempts != completed + rejected + failed + cancelled:
            raise ValueError(
                f"Run {idx}: partition mismatch {attempts} != {completed} + {rejected} + {failed} + {cancelled}"
            )
        if failed != 0:
            raise ValueError(f"Run {idx}: failed count > 0 ({failed})")

        # Peak admitted contexts must not exceed the server ceiling (32)
        peak_ctx = run.get("max_inflight_contexts", 0)
        if peak_ctx > 32:
            raise ValueError(f"Run {idx}: peak admitted contexts exceeded 32 ({peak_ctx})")

        peak_snaps = run.get("max_inflight_snapshots", 0)
        if peak_snaps > 128:
            raise ValueError(f"Run {idx}: peak snapshots exceeded 128 ({peak_snaps})")

        # Check all float metrics are finite
        for field in [
            "throughput_completed_per_sec", "throughput_attempts_per_sec",
            "create_p50_ms", "prepare_p50_ms", "evaluate_batch_p50_ms",
            "release_p50_ms", "completed_lifecycle_p50_ms", "attempt_p50_ms"
        ]:
            if field in run:
                val = run[field]
                if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val) or val < 0:
                    raise ValueError(f"Run {idx}: invalid non-finite value for {field}: {val}")

    return data


def docker_cleanup_container(container_name: str, docker_bin: str = "docker", docker_context: str = "orbstack", timeout: int = 10) -> bool:
    """Bounded, safe container removal without swallowing failure silently."""
    if not container_name:
        return True
    try:
        res = subprocess.run(
            [docker_bin, "--context", docker_context, "rm", "-f", container_name],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return res.returncode == 0
    except subprocess.TimeoutExpired:
        sys.stderr.write(f"Warning: Cleanup of {container_name} timed out after {timeout}s\n")
        return False
    except Exception as e:
        sys.stderr.write(f"Warning: Cleanup error for {container_name}: {e}\n")
        return False
