#!/usr/bin/env python3
"""Control tests for profile_screen_catalog.py (no Docker needed)."""

import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import profile_screen_catalog as runner


def tar_of(*members):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for info, data in members:
            archive.addfile(info, io.BytesIO(data) if data is not None else None)
    return buffer.getvalue()


def regular(name, data):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    return info, data


class ArgvControls(unittest.TestCase):
    def setUp(self):
        self.argv = runner.docker_argv("sg-test", [("/host/store", "/store")], {"A": "1"}, ["true"], 64)

    def test_isolation_flags(self):
        joined = " ".join(self.argv)
        for flag in ["--network none", "--read-only", "--user 65532:65532", "--cap-drop ALL",
                     "--security-opt no-new-privileges", "--pull=never", "--platform linux/arm64",
                     "--context orbstack", "--cpus 2", "--memory 3g", "--memory-swap 3g", "--pids-limit 256",
                     "--ulimit fsize=", "--ulimit nofile=", "--rm", "--name sg-test"]:
            self.assertIn(flag, joined)
        self.assertIn(runner.GO_IMAGE, self.argv)
        self.assertIn("@sha256:", runner.GO_IMAGE)

    def test_only_writable_path_is_capped_tmpfs(self):
        self.assertNotIn("-v", self.argv)
        mounts = [self.argv[i + 1] for i, a in enumerate(self.argv) if a == "--mount"]
        self.assertTrue(mounts and all(m.endswith(",readonly") for m in mounts))
        tmpfs = [self.argv[i + 1] for i, a in enumerate(self.argv) if a == "--tmpfs"]
        self.assertEqual(tmpfs, ["/scratch:rw,exec,size=64m,mode=1777"])

    def test_container_env_is_explicit(self):
        env = [self.argv[i + 1] for i, a in enumerate(self.argv) if a == "-e"]
        self.assertEqual(env, ["HOME=/scratch", "TMPDIR=/scratch", "A=1"])
        self.assertNotIn("--env-file", self.argv)

    def test_docker_cli_env_is_allowlisted(self):
        self.assertEqual(set(runner.docker_env()), {"PATH", "HOME"})


class Promotion(unittest.TestCase):
    allowed = {"timing.json": 10, "log.txt": 10}

    def promote(self, stream):
        with tempfile.TemporaryDirectory() as directory:
            return runner.promote(stream, self.allowed, Path(directory) / "out")

    def test_accepts_allowlisted_files(self):
        self.assertEqual(self.promote(tar_of(regular("timing.json", b"{}"), regular("./log.txt", b"ok"))), (["timing.json", "log.txt"], 4))

    def test_rejects_unlisted_traversal_oversize_and_links(self):
        link = tarfile.TarInfo("timing.json")
        link.type, link.linkname = tarfile.SYMTYPE, "/etc/passwd"
        for stream in [tar_of(regular("other.bin", b"x")), tar_of(regular("../timing.json", b"x")),
                       tar_of(regular("timing.json", b"x" * 11)), tar_of((link, None))]:
            with self.assertRaises(ValueError):
                self.promote(stream)

    def test_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            dest = Path(directory)
            (dest / "timing.json").write_text("keep")
            with self.assertRaises(FileExistsError):
                runner.promote(tar_of(regular("timing.json", b"new")), self.allowed, dest)
            self.assertEqual((dest / "timing.json").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
