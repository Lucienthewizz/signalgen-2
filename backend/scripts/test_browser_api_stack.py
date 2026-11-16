"""Focused preflight and cleanup fault tests for verify_browser_api_stack.py.
Offline unit tests; does not start Docker or read personal environment.
"""
import io
import contextlib
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from verify_browser_api_stack import (
    API,
    GO,
    PG,
    PLAYWRIGHT,
    DOCKER,
    bounded,
    bounded_playwright,
    cleanup_containers,
    inspect_image,
    unpack,
    find_toolchain_inputs,
)


class BrowserApiStackPreflightTests(unittest.TestCase):
    def test_cleanup_attempts_remaining_resources_after_timeout(self):
        names = ["own-pg", "own-api", "own-browser"]
        with patch("verify_browser_api_stack.subprocess.run", side_effect=[
            subprocess.TimeoutExpired("docker", 20), None, None,
        ]) as remove, contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaisesRegex(RuntimeError, "own-browser"):
                cleanup_containers(names)
        self.assertEqual(
            [call.args[0] for call in remove.call_args_list],
            [DOCKER + ["rm", "-f", name] for name in reversed(names)]
        )
        self.assertIn("TimeoutExpired", errors.getvalue())

    def test_cleanup_reports_command_and_launch_failures(self):
        with patch("verify_browser_api_stack.subprocess.run", side_effect=[
            subprocess.CalledProcessError(1, "docker"), OSError("unavailable"), None,
        ]) as remove, contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(RuntimeError):
                cleanup_containers(["own-pg", "own-api", "own-browser"])
        self.assertEqual(remove.call_count, 3)
        self.assertIn("own-browser (CalledProcessError)", errors.getvalue())
        self.assertIn("own-api (OSError)", errors.getvalue())

    def test_cleanup_preserves_original_failure(self):
        original = ValueError("original stack failure")
        with patch("verify_browser_api_stack.subprocess.run", side_effect=[
            subprocess.TimeoutExpired("docker", 20), None,
        ]) as remove, contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(ValueError) as raised:
                try:
                    raise original
                finally:
                    cleanup_containers(["own-pg", "own-browser"])
        self.assertIs(raised.exception, original)
        self.assertEqual(remove.call_count, 2)
        self.assertIn("own-browser", errors.getvalue())

    def test_bounded_container_arguments_enforce_isolation(self):
        args = bounded("test-api", API, [("/store", "/store")])
        self.assertIn("--read-only", args)
        self.assertIn("none", args)
        self.assertIn("ALL", args)
        self.assertIn("no-new-privileges", args)
        self.assertIn("10001:10001", args)
        self.assertNotIn("-p", args)
        self.assertNotIn("--privileged", args)
        self.assertTrue(any(x.startswith("type=bind") and x.endswith(",readonly") for x in args))

    def test_bounded_playwright_enforces_sandbox_and_private_shm(self):
        args = bounded_playwright(
            "test-pw",
            PLAYWRIGHT,
            [("/node_modules", "/node_modules", True), ("/output", "/output", False)],
            network="container:test-pg",
            user="1001:1001",
            memory="2g",
            scratch=512,
            shm=256,
        )
        self.assertIn("--read-only", args)
        self.assertIn("container:test-pg", args)
        self.assertIn("ALL", args)
        self.assertIn("no-new-privileges", args)
        self.assertIn("1001:1001", args)
        self.assertNotIn("-p", args)
        self.assertNotIn("--privileged", args)
        self.assertNotIn("--ipc=host", args)
        # Private bounded /dev/shm
        self.assertIn("/dev/shm:rw,exec,size=256m,mode=1777", " ".join(args))
        # Ensure /node_modules is readonly while /output is rw
        self.assertTrue(any("src=/node_modules,dst=/node_modules,readonly" in x for x in args))
        self.assertTrue(any("src=/output,dst=/output" in x and not x.endswith(",readonly") for x in args))

    def test_image_inspection_validates_identity_platform_hooks(self):
        valid = json.dumps([{
            "Id": PLAYWRIGHT,
            "Architecture": "arm64",
            "Config": {}
        }]).encode()
        with patch("verify_browser_api_stack.call", return_value=valid):
            res = inspect_image(PLAYWRIGHT)
            self.assertEqual(res["Id"], PLAYWRIGHT)

        invalid_arch = json.dumps([{
            "Id": PLAYWRIGHT,
            "Architecture": "amd64",
            "Config": {}
        }]).encode()
        with patch("verify_browser_api_stack.call", return_value=invalid_arch):
            with self.assertRaisesRegex(ValueError, "Pinned image identity/platform/hooks changed"):
                inspect_image(PLAYWRIGHT)

        with_onbuild = json.dumps([{
            "Id": PLAYWRIGHT,
            "Architecture": "arm64",
            "Config": {"OnBuild": ["RUN something"]}
        }]).encode()
        with patch("verify_browser_api_stack.call", return_value=with_onbuild):
            with self.assertRaisesRegex(ValueError, "Pinned image identity/platform/hooks changed"):
                inspect_image(PLAYWRIGHT)

    def test_unpack_archive_security_guards(self):
        for name, kind, size in [
            ("../traversal", tarfile.REGTYPE, 1),
            ("symlink_entry", tarfile.SYMTYPE, 0),
            ("oversized", tarfile.REGTYPE, 32 * 1024 * 1024 + 1),
        ]:
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w") as archive:
                member = tarfile.TarInfo(name)
                member.type, member.size = kind, size
                archive.fileobj.write(member.tobuf())
            with self.assertRaises(ValueError):
                unpack(out.getvalue(), {name})

        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w") as archive:
            member = tarfile.TarInfo("valid_elf")
            member.size = 4
            archive.addfile(member, io.BytesIO(b"\x7fELF"))
        self.assertEqual(unpack(out.getvalue(), {"valid_elf"}), {"valid_elf": b"\x7fELF"})
        with self.assertRaises(ValueError):
            unpack(out.getvalue(), {"valid_elf", "missing_required"})

    def test_find_toolchain_inputs(self):
        node_modules, dist = find_toolchain_inputs()
        self.assertTrue(node_modules.is_dir())
        self.assertTrue(dist.is_dir())
        pw_json = json.loads((node_modules / "playwright/package.json").read_text())
        self.assertEqual(pw_json.get("version"), "1.64.1")
        self.assertTrue((dist / "index.html").is_file())
        self.assertTrue((dist / "wasm/signalgen_core.wasm").is_file())


if __name__ == "__main__":
    unittest.main()
