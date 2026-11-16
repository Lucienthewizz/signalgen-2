"""Focused preflight and cleanup fault tests for verify_browser_api_stack.py.
Offline unit tests; does not start Docker or read personal environment.
"""
import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
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
    verify_approved_build_inputs,
    extract_approved_package,
    find_base_node_modules,
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
            [("/node_modules", "/node_modules", True), ("/dist", "/dist", True)],
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
        # Ensure all mounts are readonly
        self.assertTrue(any("src=/node_modules,dst=/node_modules,readonly" in x for x in args))
        self.assertTrue(any("src=/dist,dst=/dist,readonly" in x for x in args))
        # No host output mount
        self.assertFalse(any("dst=/output" in x for x in args))

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

    def test_find_base_node_modules(self):
        node_modules = find_base_node_modules()
        self.assertTrue(node_modules.is_dir())
        pw_json = json.loads((node_modules / "playwright/package.json").read_text())
        self.assertEqual(pw_json.get("version"), "1.64.1")

    def test_verify_approved_build_inputs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            archive_data = b"dummy tar package content"
            archive_sha256 = hashlib.sha256(archive_data).hexdigest()
            archive_sri = "sha512-" + base64.b64encode(hashlib.sha512(archive_data).digest()).decode("utf-8")
            archive_path = tmp / "test-pkg.tgz"
            archive_path.write_bytes(archive_data)

            lockfile_obj = {
                "packages": {
                    "node_modules/test-pkg": {
                        "version": "1.0.0",
                        "integrity": archive_sri,
                    }
                }
            }
            lockfile_bytes = json.dumps(lockfile_obj).encode("utf-8")
            lockfile_hash = hashlib.sha256(lockfile_bytes).hexdigest()
            lockfile_path = tmp / "package-lock.json"
            lockfile_path.write_bytes(lockfile_bytes)

            manifest_obj = {
                "lockfile_sha256": lockfile_hash,
                "packages": [
                    {
                        "package": "test-pkg",
                        "version": "1.0.0",
                        "integrity": archive_sri,
                        "sha256": archive_sha256,
                        "bytes": len(archive_data),
                        "archive": str(archive_path),
                    }
                ]
            }
            manifest_path = tmp / "manifest.json"
            manifest_path.write_text(json.dumps(manifest_obj))

            # Valid check
            verified = verify_approved_build_inputs(manifest_path, lockfile_path)
            self.assertEqual(len(verified), 1)
            self.assertEqual(verified[0]["package"], "test-pkg")

            # Mismatched lockfile sha256
            bad_manifest = dict(manifest_obj, lockfile_sha256="wrong-hash")
            manifest_path.write_text(json.dumps(bad_manifest))
            with self.assertRaisesRegex(ValueError, "Lockfile SHA256 mismatch"):
                verify_approved_build_inputs(manifest_path, lockfile_path)

            # Mismatched archive SRI
            bad_sri_manifest = dict(manifest_obj, packages=[
                dict(manifest_obj["packages"][0], integrity="sha512-wrong")
            ])
            manifest_path.write_text(json.dumps(bad_sri_manifest))
            with self.assertRaisesRegex(ValueError, "Package integrity/version mismatch"):
                verify_approved_build_inputs(manifest_path, lockfile_path)

    def test_extract_approved_package_security_bounds(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)

            # Traversal entry rejected
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w:gz") as tar:
                ti = tarfile.TarInfo("package/../secret")
                ti.size = 5
                tar.addfile(ti, io.BytesIO(b"hello"))
            archive_bad = tmp / "bad-traversal.tgz"
            archive_bad.write_bytes(out.getvalue())
            with self.assertRaisesRegex(ValueError, "Traversal path"):
                extract_approved_package(archive_bad, tmp / "dest1")

            # Symlink entry rejected
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w:gz") as tar:
                ti = tarfile.TarInfo("package/link")
                ti.type = tarfile.SYMTYPE
                tar.fileobj.write(ti.tobuf())
            archive_sym = tmp / "bad-symlink.tgz"
            archive_sym.write_bytes(out.getvalue())
            with self.assertRaisesRegex(ValueError, "Forbidden member type"):
                extract_approved_package(archive_sym, tmp / "dest2")

            # Valid extraction
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w:gz") as tar:
                ti_dir = tarfile.TarInfo("package/bin")
                ti_dir.type = tarfile.DIRTYPE
                tar.addfile(ti_dir)

                ti_file = tarfile.TarInfo("package/bin/run")
                ti_file.size = 5
                ti_file.mode = 0o755
                tar.addfile(ti_file, io.BytesIO(b"hello"))
            archive_good = tmp / "good.tgz"
            archive_good.write_bytes(out.getvalue())
            dest = tmp / "dest3"
            extract_approved_package(archive_good, dest)
            self.assertTrue((dest / "bin/run").is_file())
            self.assertEqual((dest / "bin/run").read_bytes(), b"hello")


if __name__ == "__main__":
    unittest.main()
