"""Trusted preflight tests: no Docker process or application is launched."""
import io
import tarfile
import unittest
from build_local_runtime import ROOT, RUNTIME_INPUT, review_base, review_recipe, unpack_named


class PackagingPreflight(unittest.TestCase):
    def test_recipe_cannot_execute_or_resolve_a_remote_base(self):
        recipe = (ROOT / "backend/LocalRuntime.Dockerfile").read_text()
        review_recipe(recipe)
        for changed in [recipe.replace("FROM scratch", "FROM remote"), recipe + "\nRUN unsafe", recipe + "\nONBUILD RUN unsafe", recipe.replace("COPY runtime/", "COPY --from=remote runtime/"), "# syntax=remote\n" + recipe, recipe.replace("ENV PATH", "ENV EXTRA=unsafe\nENV PATH")]:
            with self.assertRaises(ValueError):
                review_recipe(changed)

    def test_hooks_and_environment_are_rejected(self):
        valid = {"Id": RUNTIME_INPUT, "Config": {"Cmd": ["signalgen-api"], "User": "signalgen", "Env": ["PATH=/usr/local/bin"]}}
        review_base(valid)
        for field, value in [("OnBuild", ["RUN untrusted"]), ("Entrypoint", ["untrusted"]), ("Env", ["TOKEN=do-not-display"])]:
            changed = {"Id": RUNTIME_INPUT, "Config": {**valid["Config"], field: value}}
            with self.assertRaises(ValueError):
                review_base(changed)

    def test_only_named_bounded_regular_artifacts(self):
        for name, kind, size, accepted in [("api", tarfile.REGTYPE, 2, True), ("../api", tarfile.REGTYPE, 2, False), ("api", tarfile.SYMTYPE, 0, False), ("api", tarfile.REGTYPE, 9, False)]:
            raw = io.BytesIO()
            with tarfile.open(fileobj=raw, mode="w") as archive:
                member = tarfile.TarInfo(name)
                member.type, member.size = kind, size
                archive.addfile(member, io.BytesIO(b"x" * size))
            if accepted:
                self.assertEqual(unpack_named(raw.getvalue(), {"api": 8}), {"api": b"xx"})
            else:
                with self.assertRaises(ValueError):
                    unpack_named(raw.getvalue(), {"api": 8})


if __name__ == "__main__":
    unittest.main()
