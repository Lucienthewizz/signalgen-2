"""Trusted parser/preflight checks; never starts Docker or reads personal env."""
import io
import contextlib
import subprocess
import tarfile
import unittest
from unittest.mock import patch
from verify_local_api_stack import API, DOCKER, bounded, cleanup_containers, unpack


class LocalStackPreflight(unittest.TestCase):
    def test_cleanup_attempts_remaining_resources_after_timeout(self):
        names = ["own-pg", "own-api", "own-verify"]
        with patch("verify_local_api_stack.subprocess.run", side_effect=[
            subprocess.TimeoutExpired("docker", 20), None, None,
        ]) as remove, contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaisesRegex(RuntimeError, "own-verify"):
                cleanup_containers(names)
        self.assertEqual([call.args[0] for call in remove.call_args_list], [
            DOCKER + ["rm", "-f", name] for name in reversed(names)
        ])
        self.assertIn("TimeoutExpired", errors.getvalue())

    def test_cleanup_reports_command_and_launch_failures(self):
        with patch("verify_local_api_stack.subprocess.run", side_effect=[
            subprocess.CalledProcessError(1, "docker"), OSError("unavailable"), None,
        ]) as remove, contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(RuntimeError):
                cleanup_containers(["own-pg", "own-api", "own-verify"])
        self.assertEqual(remove.call_count, 3)
        self.assertIn("own-verify (CalledProcessError)", errors.getvalue())
        self.assertIn("own-api (OSError)", errors.getvalue())

    def test_cleanup_preserves_original_failure(self):
        original = ValueError("original stack failure")
        with patch("verify_local_api_stack.subprocess.run", side_effect=[
            subprocess.TimeoutExpired("docker", 20), None,
        ]) as remove, contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(ValueError) as raised:
                try:
                    raise original
                finally:
                    cleanup_containers(["own-pg", "own-api"])
        self.assertIs(raised.exception, original)
        self.assertEqual(remove.call_count, 2)
        self.assertIn("own-api", errors.getvalue())

    def test_cleanup_success_is_bounded_and_exactly_scoped(self):
        with patch("verify_local_api_stack.subprocess.run") as remove:
            cleanup_containers(["own-pg"])
        remove.assert_called_once_with(DOCKER + ["rm", "-f", "own-pg"],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                      timeout=20, check=True)

    def test_artifacts_reject_links_traversal_missing_and_oversize(self):
        for name, kind, size in [("../main", tarfile.REGTYPE, 1),
                                 ("main", tarfile.SYMTYPE, 0),
                                 ("main", tarfile.REGTYPE, 32*1024*1024+1)]:
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w") as archive:
                member = tarfile.TarInfo(name)
                member.type, member.size = kind, size
                # Headers suffice for rejected members; no oversized allocation.
                archive.fileobj.write(member.tobuf())
            with self.assertRaises(ValueError):
                unpack(out.getvalue(), {"main"})
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w") as archive:
            member = tarfile.TarInfo("main")
            member.size = 3
            archive.addfile(member, io.BytesIO(b"ELF"))
        self.assertEqual(unpack(out.getvalue(), {"main"}), {"main": b"ELF"})
        with self.assertRaises(ValueError):
            unpack(out.getvalue(), {"main", "missing"})

    def test_runtime_has_no_published_port_or_writable_bind(self):
        args = bounded("test-only", API, [("/private/test-input", "/store")])
        self.assertIn("--read-only", args)
        self.assertIn("none", args)
        self.assertIn("ALL", args)
        self.assertNotIn("-p", args)
        self.assertNotIn("--privileged", args)
        self.assertTrue(next(x for x in args if x.startswith("type=bind")).endswith(",readonly"))


if __name__ == "__main__":
    unittest.main()
