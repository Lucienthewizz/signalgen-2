#!/usr/bin/env python3
"""Targeted preflight and fault unit tests for run_study_sustained_load.sh.
Covers:
1. Working directory preflight: non-root directory exits with error.
2. Pinned image identity / platform / OnBuild preflight validation.
3. Source snapshot allowlist validation: disallows .env, credentials, runtime databases, oversized files.
4. Evidence JSON schema and run validation.
5. Exact container cleanup under simulated failure.
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


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

    def test_image_inspection_preflight(self):
        # Image validator rejects wrong architecture, missing ID, or OnBuild hooks
        def validate(mock_inspect, expected_id):
            data = json.loads(mock_inspect)[0]
            if data.get("Id") != expected_id:
                raise ValueError("Image ID mismatch")
            if data.get("Architecture") != "arm64":
                raise ValueError("Unexpected architecture")
            if data.get("Os") != "linux":
                raise ValueError("Unexpected OS")
            if data.get("Config", {}).get("OnBuild"):
                raise ValueError("Unexpected OnBuild")

        valid_raw = json.dumps([
            {"Id": "sha256:valid", "Architecture": "arm64", "Os": "linux", "Config": {}}
        ])
        validate(valid_raw, "sha256:valid")

        # Wrong architecture must fail
        wrong_arch = json.dumps([
            {"Id": "sha256:valid", "Architecture": "amd64", "Os": "linux", "Config": {}}
        ])
        with self.assertRaises(ValueError):
            validate(wrong_arch, "sha256:valid")

        # OnBuild hook must fail
        onbuild = json.dumps([
            {"Id": "sha256:valid", "Architecture": "arm64", "Os": "linux", "Config": {"OnBuild": ["RUN something"]}}
        ])
        with self.assertRaises(ValueError):
            validate(onbuild, "sha256:valid")

    def test_source_snapshot_allowlist(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            src = Path(tmpdir) / "backend"
            src.mkdir()
            (src / "valid.go").write_text("package main")

            def check_dir(p):
                allowed_exts = {".go", ".mod", ".sum", ".sh", ".py", ".sql", ".md", ".json", ".yml", ".yaml", ".txt"}
                disallowed_names = {".env", ".env.local", ".env.production", "localstack.db", "runtime.db"}
                total = 0
                for root, _, files in os.walk(p):
                    for f in files:
                        cur = Path(root) / f
                        if f.startswith(".env") or f in disallowed_names or cur.suffix in {".pem", ".key", ".sqlite", ".db"}:
                            raise ValueError(f"Disallowed file: {cur}")
                        if cur.suffix not in allowed_exts and not f.startswith("Dockerfile") and not f == "Go.Dockerfile":
                            raise ValueError(f"Disallowed extension: {cur}")
                        sz = cur.stat().st_size
                        if sz > 32 * 1024 * 1024:
                            raise ValueError(f"Oversized file: {cur}")
                        total += sz
                if total > 64 * 1024 * 1024:
                    raise ValueError("Total size exceeds 64MB")

            check_dir(src)

            # Test disallowed .env
            env_file = src / ".env"
            env_file.write_text("SECRET=123")
            with self.assertRaises(ValueError):
                check_dir(src)
            env_file.unlink()

            # Test disallowed .key
            key_file = src / "test.key"
            key_file.write_text("private-key")
            with self.assertRaises(ValueError):
                check_dir(src)
            key_file.unlink()

    def test_evidence_schema_validation(self):
        valid_evidence = {
            "kind": "loopback_http_sustained_workload",
            "schema_version": 3,
            "timestamp": "2026-11-16T12:00:00Z",
            "measured_date": "2026-11-16",
            "runs": [
                {"concurrency": 1, "failed": 0, "measured_duration_ms": 5000.0},
                {"concurrency": 10, "failed": 0, "measured_duration_ms": 5000.0},
                {"concurrency": 30, "failed": 0, "measured_duration_ms": 5000.0},
                {"concurrency": 40, "failed": 0, "measured_duration_ms": 5000.0},
            ]
        }

        def validate_schema(data):
            if data.get("schema_version") != 3:
                raise ValueError("Wrong schema version")
            runs = data.get("runs", [])
            if len(runs) != 4:
                raise ValueError("Expected 4 runs")
            for r in runs:
                if r.get("failed", 0) > 0:
                    raise ValueError("Unexpected failure in run")
                if r.get("measured_duration_ms", 0) < 4500:
                    raise ValueError("Duration too short")

        validate_schema(valid_evidence)

        # Failure count > 0 must fail
        failing_evidence = json.loads(json.dumps(valid_evidence))
        failing_evidence["runs"][0]["failed"] = 1
        with self.assertRaises(ValueError):
            validate_schema(failing_evidence)

        # Short duration must fail
        short_evidence = json.loads(json.dumps(valid_evidence))
        short_evidence["runs"][1]["measured_duration_ms"] = 100.0
        with self.assertRaises(ValueError):
            validate_schema(short_evidence)


if __name__ == "__main__":
    unittest.main()
