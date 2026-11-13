"""Trusted parser/preflight checks; never starts Docker or reads personal env."""
import io
import tarfile
import unittest
from verify_local_api_stack import API, bounded, unpack


class LocalStackPreflight(unittest.TestCase):
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
