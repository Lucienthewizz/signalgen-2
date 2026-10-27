import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  localOrigin,
  verifyArtifact,
  runPreflight,
} from "./demo_preflight.mjs";

const contract = "info:\n  title: SignalGen\n  version: 0.10.0\n";
const wasm = Buffer.from("signalgenComputeFeatures fixture bytes");
const runtime = Buffer.from("Go runtime fixture");
const hash = (content) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;
const manifest = {
  engine_version: "core-0.5.0",
  schema_version: "signal-baseline-1",
  feature_schema_version: "screener-features-1",
  worker_protocol: "worker-2",
  capabilities_version: "capabilities-4",
  wasm_file: "signalgen_core.wasm",
  runtime_file: "wasm_exec.js",
  wasm_sha256: hash(wasm),
  wasm_bytes: wasm.length,
  runtime_sha256: hash(runtime),
  runtime_bytes: runtime.length,
};
function transport(override = () => undefined) {
  return async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, undefined);
    const changed = override(url);
    if (changed) return changed;
    const path = new URL(url).pathname;
    if (path === "/api/openapi.yaml") return new Response(contract);
    if (path === "/wasm/signalgen_core.wasm") return new Response(wasm);
    if (path === "/wasm/wasm_exec.js") return new Response(runtime);
    const payload = {
      "/health": { status: "ok" },
      "/ready": { status: "ready" },
      "/api": {
        name: "SignalGen Go API",
        version: "0.10.0",
        docs: "/api/openapi.yaml",
      },
      "/wasm/signalgen_core.manifest.json": manifest,
      "/api/auth/me": { error: { code: "AUTH_REQUIRED", request_id: "test" } },
      "/api/demo-preflight-not-a-route": {
        error: { code: "RESOURCE_NOT_FOUND" },
      },
    }[path];
    return new Response(JSON.stringify(payload), {
      status:
        path === "/api/auth/me"
          ? 401
          : path.includes("not-a-route")
            ? 404
            : 200,
      headers: { "cache-control": "private, no-store" },
    });
  };
}
const run = (request) =>
  runPreflight({
    api: "http://127.0.0.1:8080",
    web: "http://127.0.0.1:5174",
    contract,
    request,
  });

test("preflight rejects remote destinations and credential-bearing origins", () => {
  for (const origin of [
    "https://example.com",
    "http://user:password@localhost",
    "http://localhost/?token=private",
    "http://localhost/api",
  ])
    assert.throws(() => localOrigin(origin));
});
test("all checks are read-only and pass on a matching deployment", async () => {
  const results = await run(transport());
  assert.equal(results.length, 8);
  assert.ok(results.every((result) => result.passed));
});
test("a stale frontend proxy cannot pass based on HTTP 200 alone", async () => {
  const results = await run(
    transport((url) =>
      url === "http://127.0.0.1:5174/api"
        ? new Response(
            JSON.stringify({ name: "SignalGen Go API", version: "old" }),
          )
        : undefined,
    ),
  );
  assert.equal(
    results.find((result) => result.name === "Frontend proxy version").passed,
    false,
  );
});
test("a backend without working database readiness fails", async () => {
  const results = await run(
    transport((url) =>
      url.endsWith("/ready")
        ? new Response("unavailable", { status: 503 })
        : undefined,
    ),
  );
  assert.equal(
    results.find((result) => result.name.includes("readiness")).passed,
    false,
  );
});
test("corrupt artifacts and manifests fail their checksum guard", async () => {
  assert.throws(() => verifyArtifact(wasm, hash(runtime), wasm.length));
  assert.throws(() => verifyArtifact(wasm, hash(wasm), wasm.length + 1));
  const results = await run(
    transport((url) =>
      url.endsWith(".wasm") ? new Response("wrong file") : undefined,
    ),
  );
  assert.equal(
    results.find((result) => result.name.includes("Go/WASM")).passed,
    false,
  );
});
