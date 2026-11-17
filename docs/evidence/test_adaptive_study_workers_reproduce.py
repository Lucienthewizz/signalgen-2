import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).with_name("adaptive-study-workers-reproduce.py")
SPEC = importlib.util.spec_from_file_location("adaptive_reproduce", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ReproductionRunnerTests(unittest.TestCase):
    def test_smoke_and_default_schedules_are_explicit(self):
        self.assertEqual(len(MODULE.case_schedule(True)), 1)
        self.assertEqual(len(MODULE.case_schedule(False)), 4)
        self.assertEqual(
            [case[3] for pair in MODULE.case_schedule(False) for case in pair],
            [
                "small-adaptive-1",
                "small-baseline-1",
                "small-adaptive-2",
                "small-baseline-2",
                "heavy-adaptive-1",
                "heavy-baseline-1",
                "heavy-adaptive-2",
                "heavy-baseline-2",
            ],
        )

    def test_snapshot_excludes_secrets_dependencies_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ("safe.ts", ".env", "nested/.env.local", "nested/credentials.txt"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("private" if "env" in name or "credential" in name else "safe")
            (root / "link.ts").symlink_to(root / "safe.ts")
            listing = b"\0".join(
                name.encode()
                for name in (
                    "safe.ts",
                    ".env",
                    "nested/.env.local",
                    "nested/credentials.txt",
                    "link.ts",
                )
            ) + b"\0"
            with tempfile.TemporaryDirectory() as snapshot:
                with mock.patch.object(
                    MODULE.subprocess, "check_output", return_value=listing
                ):
                    hashes = MODULE.tracked_snapshot(root, pathlib.Path(snapshot))
                self.assertEqual(list(hashes), ["safe.ts"])
                self.assertTrue((pathlib.Path(snapshot) / "safe.ts").is_file())

    def test_docker_arguments_are_isolated_and_explicit(self):
        args = MODULE.docker_args(
            "owned-case",
            pathlib.Path("/snapshot"),
            pathlib.Path("/deps"),
            pathlib.Path("/wasm"),
            4,
            250,
            3,
        )
        self.assertIn("--context", args)
        self.assertIn("orbstack", args)
        self.assertIn("--network", args)
        self.assertIn("none", args)
        self.assertIn("--cap-drop", args)
        self.assertIn("ALL", args)
        self.assertIn("--security-opt", args)
        self.assertIn("no-new-privileges", args)
        self.assertIn("/usr/bin/env", args)
        self.assertIn("-i", args)
        self.assertIn("WORKERS=4", args)
        self.assertIn("CANDLES=250", args)
        self.assertIn("OPERANDS=3", args)

    def test_comparator_runs_node_inside_owned_container(self):
        args = MODULE.comparator_args(
            "compare-case",
            pathlib.Path("/compare.mjs"),
            pathlib.Path("/adaptive.json"),
            pathlib.Path("/baseline.json"),
        )
        self.assertIn("compare-case", args)
        self.assertIn("node", args)
        self.assertIn("/scratch/compare.mjs", args)
        self.assertIn("--cap-drop", args)
        self.assertIn("ALL", args)
        self.assertIn("--security-opt", args)
        self.assertIn("no-new-privileges", args)
        self.assertIn("-i", args)
        self.assertNotIn("frontend/web/tests/browser/compare-signal-study-evidence.mjs", args)

    def test_compare_cases_never_invokes_host_node(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            output = root / "evidence"
            output.mkdir()
            with mock.patch.object(
                MODULE, "run_bounded", return_value=(0, b"", b"")
            ), mock.patch.object(MODULE.subprocess, "run") as host_run:
                owned = []
                MODULE.compare_cases(
                    root,
                    output,
                    "adaptive",
                    "baseline",
                    owned,
                    MODULE.time.monotonic() + 10,
                )
            self.assertEqual(host_run.call_count, 0)
            self.assertEqual(len(owned), 1)

    def test_bounded_process_rejects_output_overflow(self):
        with self.assertRaises(MODULE.OutputLimitExceeded):
            MODULE.run_bounded(
                ["python3", "-c", "print('x' * 10000)"],
                timeout=10,
                output_limit=100,
            )

    def test_cleanup_attempts_every_owned_container(self):
        calls = []

        def remove(args, **kwargs):
            calls.append(args[-1])
            if len(calls) == 1:
                raise subprocess.TimeoutExpired(args, 20)
            return mock.DEFAULT

        with mock.patch.object(MODULE.subprocess, "run", side_effect=remove):
            with self.assertRaises(RuntimeError):
                MODULE.cleanup(["owned-a", "owned-b"])
        self.assertEqual(calls, ["owned-a", "owned-b"])

    def test_timeout_kills_named_container_before_propagating(self):
        with tempfile.TemporaryDirectory() as temp:
            owned = []
            with mock.patch.object(
                MODULE, "run_bounded", side_effect=TimeoutError("timeout")
            ), mock.patch.object(MODULE.subprocess, "run") as run:
                with self.assertRaises(TimeoutError):
                    MODULE.run_case(
                        pathlib.Path(temp),
                        pathlib.Path(temp),
                        pathlib.Path(temp),
                        pathlib.Path(temp),
                        pathlib.Path(temp),
                        4,
                        250,
                        3,
                        "timeout-case",
                        owned,
                        MODULE.time.monotonic() + 10,
                    )
            self.assertEqual(len(owned), 1)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][3], "kill")


if __name__ == "__main__":
    unittest.main()
