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
    ROOT,
    bounded,
    bounded_playwright,
    cleanup_containers,
    inspect_image,
    unpack,
    extract_dist_archive,
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

    def test_extract_dist_archive_security_bounds(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)

            # Symlink rejected
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w") as tar:
                ti = tarfile.TarInfo("link")
                ti.type = tarfile.SYMTYPE
                tar.fileobj.write(ti.tobuf())
            with self.assertRaisesRegex(ValueError, "Forbidden member type"):
                extract_dist_archive(out.getvalue(), tmp / "dest1")

            # Traversal rejected
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w") as tar:
                ti = tarfile.TarInfo("../escape")
                ti.size = 3
                tar.addfile(ti, io.BytesIO(b"abc"))
            with self.assertRaisesRegex(ValueError, "Traversal path"):
                extract_dist_archive(out.getvalue(), tmp / "dest2")

            # Duplicate entry rejected
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w") as tar:
                ti1 = tarfile.TarInfo("file.txt")
                ti1.size = 3
                tar.addfile(ti1, io.BytesIO(b"abc"))
                ti2 = tarfile.TarInfo("file.txt")
                ti2.size = 3
                tar.addfile(ti2, io.BytesIO(b"def"))
            with self.assertRaisesRegex(ValueError, "Duplicate entry"):
                extract_dist_archive(out.getvalue(), tmp / "dest3")

            # Oversized member rejected
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w") as tar:
                ti = tarfile.TarInfo("big.bin")
                ti.size = 17 * 1024 * 1024
                tar.fileobj.write(ti.tobuf())
            with self.assertRaisesRegex(ValueError, "Oversized member"):
                extract_dist_archive(out.getvalue(), tmp / "dest4")

            # Valid extraction
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w") as tar:
                ti_dir = tarfile.TarInfo("assets")
                ti_dir.type = tarfile.DIRTYPE
                tar.addfile(ti_dir)
                ti_file = tarfile.TarInfo("assets/index.js")
                ti_file.size = 4
                tar.addfile(ti_file, io.BytesIO(b"test"))
            dest_valid = tmp / "dest_valid"
            extract_dist_archive(out.getvalue(), dest_valid)
            self.assertTrue((dest_valid / "assets/index.js").is_file())
            self.assertEqual((dest_valid / "assets/index.js").read_bytes(), b"test")

    def test_verify_wasm_boundary_script_fixtures(self):
        script_path = ROOT / "backend/scripts/verify_wasm_boundary.sh"
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)

            # 1. Valid positive fixture
            pos_wasm = tmp / "valid.wasm"
            pos_content = (
                b"\x00asm\x01\x00\x00\x00"
                b"signalgenComputeFeatures"
                b"signalgenRunBacktest"
                b"signalgenComputeBacktestFeatures"
                b"signalgenBacktestCapabilities"
                b"signalgenRunSignalStudy"
            )
            pos_wasm.write_bytes(pos_content)
            res = subprocess.run(["bash", str(script_path), str(pos_wasm)], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0)
            self.assertIn("WASM boundary markers verified", res.stdout)

            # 2. Missing required marker fixture
            missing_wasm = tmp / "missing.wasm"
            missing_content = (
                b"\x00asm\x01\x00\x00\x00"
                b"signalgenRunBacktest"
                b"signalgenComputeBacktestFeatures"
                b"signalgenBacktestCapabilities"
                b"signalgenRunSignalStudy"
            )
            missing_wasm.write_bytes(missing_content)
            res = subprocess.run(["bash", str(script_path), str(missing_wasm)], capture_output=True, text=True)
            self.assertEqual(res.returncode, 1)
            self.assertIn("missing signalgenComputeFeatures export marker", res.stderr)

            # 3. Forbidden marker fixture (RULE_MATCHED)
            forbidden_wasm = tmp / "forbidden.wasm"
            forbidden_content = pos_content + b"RULE_MATCHED"
            forbidden_wasm.write_bytes(forbidden_content)
            res = subprocess.run(["bash", str(script_path), str(forbidden_wasm)], capture_output=True, text=True)
            self.assertEqual(res.returncode, 1)
            self.assertIn("forbidden decision marker found in WASM", res.stderr)

    def test_csv_canonical_equality_comparator_unit_probe(self):
        scenario_path = ROOT / "frontend/web/tests/browser/real-api-study.scenario.js"
        node_script = f"""
import {{ verifyCsvCanonicalEquality }} from "file://{scenario_path}";

function generateValidDataset() {{
    const header = '"symbol","signal_time","direction","reference_close","horizon","basis","status","price","return_pct","currency","policy","catalog_hash"';
    const lines = [header];
    const expectedRows = [];
    const catalogHash = "a1b2c3d4e5f67890123456789012345678901234567890123456789012345678";
    const bases = ["open", "high", "close", "open", "high", "close", "open", "high", "close", "barrier"];
    const horizons = [1, 1, 1, 2, 2, 2, 3, 3, 3, 3];

    for (let e = 0; e < 48; e++) {{
        const sym = `BBCA_${{e}}`;
        const time = `2026-11-16T10:${{String(e).padStart(2, "0")}}:00Z`;
        const dir = e % 2 === 0 ? "BUY" : "SELL";
        const refClose = 10000 + e * 10;
        for (let o = 0; o < 10; o++) {{
            const h = horizons[o];
            const b = bases[o];
            const st = o === 9 ? "time_exit" : "evaluated";
            const price = refClose + (o + 1) * 25;
            const ret = Number(((price - refClose) / refClose * 100).toFixed(4));
            lines.push(`"${{sym}}","${{time}}","${{dir}}",${{refClose}},${{h}},"${{b}}","${{st}}",${{price}},${{ret}},"IDR","SL-first","${{catalogHash}}"`);
            expectedRows.push({{
                symbol: sym,
                signal_time: time,
                direction: dir,
                reference_close: refClose,
                horizon: h,
                basis: b,
                status: st,
                price: price,
                return_pct: ret,
                currency: "IDR",
                policy: "SL-first",
            }});
        }}
    }}
    return {{ csvText: lines.join("\\n"), expectedRows, catalogHash }};
}}

// 1. Valid dataset verification
const {{ csvText, expectedRows, catalogHash }} = generateValidDataset();
const res = verifyCsvCanonicalEquality(csvText, expectedRows, {{ currency: "IDR", policy: "SL-first" }});
if (!res.valid || res.totalRows !== 480 || res.eventsCount !== 48 || res.catalogHash !== catalogHash) {{
    throw new Error("Valid dataset failed verification");
}}

// 2. Negative mutation: price mismatch on row 5
{{
    const mutated = expectedRows.map((r, i) => i === 5 ? {{ ...r, price: r.price + 100 }} : r);
    let threw = false;
    try {{
        verifyCsvCanonicalEquality(csvText, mutated, {{ currency: "IDR", policy: "SL-first" }});
    }} catch (e) {{
        threw = true;
        if (!e.message.includes("price mismatch")) throw new Error("Unexpected error message: " + e.message);
    }}
    if (!threw) throw new Error("Price mutation should have failed");
}}

// 3. Negative mutation: return_pct mismatch on row 10
{{
    const mutated = expectedRows.map((r, i) => i === 10 ? {{ ...r, return_pct: r.return_pct + 1.5 }} : r);
    let threw = false;
    try {{
        verifyCsvCanonicalEquality(csvText, mutated, {{ currency: "IDR", policy: "SL-first" }});
    }} catch (e) {{
        threw = true;
        if (!e.message.includes("return_pct mismatch")) throw new Error("Unexpected error message: " + e.message);
    }}
    if (!threw) throw new Error("Return_pct mutation should have failed");
}}

// 4. Negative mutation: status mismatch on row 15
{{
    const mutated = expectedRows.map((r, i) => i === 15 ? {{ ...r, status: "stop_loss" }} : r);
    let threw = false;
    try {{
        verifyCsvCanonicalEquality(csvText, mutated, {{ currency: "IDR", policy: "SL-first" }});
    }} catch (e) {{
        threw = true;
        if (!e.message.includes("status mismatch")) throw new Error("Unexpected error message: " + e.message);
    }}
    if (!threw) throw new Error("Status mutation should have failed");
}}

// 5. Negative mutation: duplicate outcome row in CSV
{{
    const lines = csvText.split("\\n");
    lines[2] = lines[1]; // duplicate row 1 onto row 2
    const expDup = [...expectedRows];
    expDup[1] = {{ ...expDup[0] }}; // duplicate in expected as well so row check passes and duplicate detector triggers
    let threw = false;
    try {{
        verifyCsvCanonicalEquality(lines.join("\\n"), expDup, {{ currency: "IDR", policy: "SL-first" }});
    }} catch (e) {{
        threw = true;
        if (!e.message.includes("Duplicate outcome row detected")) throw new Error("Unexpected error message: " + e.message);
    }}
    if (!threw) throw new Error("Duplicate outcome mutation should have failed");
}}

// 6. Negative mutation: row count mismatch
{{
    const lines = csvText.split("\\n").slice(0, 400); // truncate
    let threw = false;
    try {{
        verifyCsvCanonicalEquality(lines.join("\\n"), expectedRows, {{ currency: "IDR", policy: "SL-first" }});
    }} catch (e) {{
        threw = true;
        if (!e.message.includes("CSV line count mismatch")) throw new Error("Unexpected error message: " + e.message);
    }}
    if (!threw) throw new Error("Row count mismatch mutation should have failed");
}}

console.log("ALL_CSV_UNIT_PROBES_PASSED");
"""
        proc = subprocess.run(["node", "--input-type=module", "-e", node_script],
                              capture_output=True, text=True, check=True)
        self.assertIn("ALL_CSV_UNIT_PROBES_PASSED", proc.stdout)


if __name__ == "__main__":
    unittest.main()
