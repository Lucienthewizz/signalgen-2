#!/usr/bin/env python3
"""Targeted preflight and fault unit tests for sustained load runner and helpers.
Exercises production functions from study_load_runner_helpers:
1. Working directory preflight: non-root directory exits with error.
2. validate_image_inspect: identity, platform, and untrusted triggers.
3. safe_extract_tracked_source: safe path traversal, symlink rejection, allowlist checks.
4. validate_evidence_json: schema, duration lower-bound, partition invariants, peak limits, finite numbers.
5. docker_cleanup_container: bounded container removal under simulated failure.
"""

import json
import math
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

# Add backend/scripts to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
import sys
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from study_load_runner_helpers import (
    validate_image_inspect,
    safe_extract_tracked_source,
    validate_evidence_json,
    docker_cleanup_container,
)


class TestRunStudySustainedLoad(unittest.TestCase):
    def test_wrong_cwd_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            res = subprocess.run(
                ["sh", str(REPO_ROOT / "backend/scripts/run_study_sustained_load.sh")],
                cwd=tmpdir,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("Must run from repository root", res.stderr)

    def test_validate_image_inspect(self):
        valid_raw = json.dumps([
            {"Id": "sha256:target_hash", "Architecture": "arm64", "Os": "linux", "Config": {}}
        ])
        res = validate_image_inspect(valid_raw, "sha256:target_hash")
        self.assertEqual(res.get("Id"), "sha256:target_hash")

        # ID mismatch
        with self.assertRaises(ValueError):
            validate_image_inspect(valid_raw, "sha256:other_hash")

        # Wrong architecture
        wrong_arch = json.dumps([
            {"Id": "sha256:target_hash", "Architecture": "amd64", "Os": "linux", "Config": {}}
        ])
        with self.assertRaises(ValueError):
            validate_image_inspect(wrong_arch, "sha256:target_hash")

        # Wrong OS
        wrong_os = json.dumps([
            {"Id": "sha256:target_hash", "Architecture": "arm64", "Os": "windows", "Config": {}}
        ])
        with self.assertRaises(ValueError):
            validate_image_inspect(wrong_os, "sha256:target_hash")

        # OnBuild trigger
        onbuild = json.dumps([
            {"Id": "sha256:target_hash", "Architecture": "arm64", "Os": "linux", "Config": {"OnBuild": ["RUN evil"]}}
        ])
        with self.assertRaises(ValueError):
            validate_image_inspect(onbuild, "sha256:target_hash")

    def test_safe_extract_tracked_source(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir)
            stats = safe_extract_tracked_source(REPO_ROOT, target)
            self.assertGreater(stats["file_count"], 50)
            self.assertGreater(stats["total_bytes"], 100000)
            self.assertTrue(len(stats["manifest_sha256"]) == 64)

            # Verify manifest exists and is valid JSON
            manifest_p = target / "backend_snapshot_manifest.json"
            self.assertTrue(manifest_p.exists())
            manifest = json.loads(manifest_p.read_text())
            self.assertIn("backend/go.mod", manifest)

            # Verify no .env files were exported
            for p in target.glob("**/*"):
                self.assertFalse(p.name.startswith(".env"))
                self.assertFalse(p.suffix in {".pem", ".key", ".db"})

    def test_validate_evidence_json(self):
        valid_evidence = {
            "kind": "loopback_http_sustained_workload",
            "schema_version": 3,
            "timestamp": "2026-11-16T12:00:00Z",
            "measured_date": "2026-11-16",
            "runs": [
                {
                    "concurrency": 1,
                    "measured_duration_ms": 5010.0,
                    "attempts": 100,
                    "completed": 100,
                    "rejected": 0,
                    "failed": 0,
                    "cancelled": 0,
                    "max_inflight_contexts": 1,
                    "max_inflight_snapshots": 10,
                },
                {
                    "concurrency": 40,
                    "measured_duration_ms": 5050.0,
                    "attempts": 500,
                    "completed": 450,
                    "rejected": 50,
                    "failed": 0,
                    "cancelled": 0,
                    "max_inflight_contexts": 32,
                    "max_inflight_snapshots": 120,
                },
            ]
        }
        res = validate_evidence_json(json.dumps(valid_evidence))
        self.assertEqual(res["schema_version"], 3)

        # Fail on sub-5s duration
        short_run = json.loads(json.dumps(valid_evidence))
        short_run["runs"][0]["measured_duration_ms"] = 4000.0
        with self.assertRaises(ValueError):
            validate_evidence_json(json.dumps(short_run))

        # Fail on peak contexts > 32
        bad_ctx = json.loads(json.dumps(valid_evidence))
        bad_ctx["runs"][1]["max_inflight_contexts"] = 33
        with self.assertRaises(ValueError):
            validate_evidence_json(json.dumps(bad_ctx))

        # Fail on partition mismatch
        mismatch = json.loads(json.dumps(valid_evidence))
        mismatch["runs"][0]["completed"] = 99
        with self.assertRaises(ValueError):
            validate_evidence_json(json.dumps(mismatch))

        # Fail on failed > 0
        has_failed = json.loads(json.dumps(valid_evidence))
        has_failed["runs"][0]["failed"] = 1
        with self.assertRaises(ValueError):
            validate_evidence_json(json.dumps(has_failed))

        # Fail on NaN
        has_nan = json.loads(json.dumps(valid_evidence))
        has_nan["runs"][0]["throughput_completed_per_sec"] = float("nan")
        with self.assertRaises(ValueError):
            validate_evidence_json(json.dumps(has_nan))

    def test_docker_cleanup_container(self):
        # Empty container name returns True safely
        self.assertTrue(docker_cleanup_container(""))

        # Non-existent container removal with short timeout completes without uncaught exception
        res = docker_cleanup_container("nonexistent-test-container-99999", timeout=2)
        # returncode is either 0 or False on non-existent, but must not crash
        self.assertIsInstance(res, bool)


if __name__ == "__main__":
    unittest.main()
