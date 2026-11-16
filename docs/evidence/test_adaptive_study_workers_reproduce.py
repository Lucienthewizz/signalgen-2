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
            def timeout_then_kill(args, **kwargs):
                if args[3] == "kill":
                    return mock.DEFAULT
                raise subprocess.TimeoutExpired(args, 1)

            with mock.patch.object(
                MODULE.subprocess, "run", side_effect=timeout_then_kill
            ) as run:
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
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[1].args[0][3], "kill")


if __name__ == "__main__":
    unittest.main()
