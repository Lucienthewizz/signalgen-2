import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from storage_benchmark_preflight import (
    run_bounded,
    validate_dependency_tree,
    validate_image_inspect,
    validate_source_files,
)


class StorageBenchmarkPreflightTests(unittest.TestCase):
    def test_image_validator_rejects_hooks_and_accepts_null_hooks(self):
        image = {"Id": "sha256:image", "Os": "linux", "Architecture": "arm64", "Config": {}}
        self.assertEqual(
            validate_image_inspect(json.dumps([image]), "sha256:image", "linux/arm64")["platform"],
            "linux/arm64",
        )
        image["Config"] = {"Entrypoint": ["/unexpected"]}
        with self.assertRaises(ValueError):
            validate_image_inspect(json.dumps([image]), "sha256:image", "linux/arm64")

    def test_dependency_validator_checks_lock_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            node_modules = root / "node_modules"
            node_modules.mkdir()
            lock = {"lockfileVersion": 3, "packages": {}}
            (root / "package-lock.json").write_text(json.dumps(lock))
            (node_modules / ".package-lock.json").write_text(json.dumps(lock))
            result = validate_dependency_tree(node_modules, root / "package-lock.json")
            self.assertEqual(result["lockfile_version"], 3)
            (node_modules / ".package-lock.json").write_text(json.dumps({"lockfileVersion": 2}))
            with self.assertRaises(ValueError):
                validate_dependency_tree(node_modules, root / "package-lock.json")

    def test_source_validator_rejects_symlink_and_forbidden_type(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "source.ts").write_text("export {}")
            (root / "notes.txt").write_text("not a source")
            self.assertIn("source.ts", validate_source_files(root, ["source.ts"]))
            with self.assertRaises(ValueError):
                validate_source_files(root, ["notes.txt"])
            (root / "link.ts").symlink_to(root / "source.ts")
            with self.assertRaises(ValueError):
                validate_source_files(root, ["link.ts"])

    def test_host_deadline_returns_timeout_status(self):
        with patch("storage_benchmark_preflight.subprocess.run", side_effect=__import__("subprocess").TimeoutExpired("x", 1)):
            with patch("sys.stderr", new_callable=io.StringIO):
                self.assertEqual(run_bounded(["true"], 1), 124)


if __name__ == "__main__":
    unittest.main()
