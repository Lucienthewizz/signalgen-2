// Read-only local demo checks: no credentials, accounts, grants or DB writes.
// Node 20+ is already needed by the web project; no extra package is installed.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function localOrigin(raw) {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Use a local origin without credentials, path or query.");
  return url.origin;
}

export function verifyArtifact(bytes, digest, length) {
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length !== bytes.byteLength ||
    digest !== `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  )
    throw new Error("Artifact size or SHA-256 does not match its manifest.");
}

export async function runPreflight({ api, web, contract, request = fetch }) {
  api = localOrigin(api);
  web = localOrigin(web);
  const version = contract
    .match(/^info:\s*\n(?:[ \t].*\n)*?[ \t]+version:[ \t]*([^\n]+)$/m)?.[1]
    ?.trim();
  if (!version) throw new Error("Cannot read the local OpenAPI version.");
  const results = [];
  async function check(name, action) {
    try {
      await action();
      results.push({ name, passed: true });
    } catch {
      results.push({ name, passed: false });
    }
  }
  async function get(origin, path, expected = 200) {
    const response = await request(`${origin}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json" },
    });
    if (response.status !== expected)
      throw new Error("Unexpected HTTP status.");
    return response;
  }
  async function metadata(origin) {
    const response = await get(origin, "/api");
    const data = await response.json();
    if (
      data.name !== "SignalGen Go API" ||
      data.version !== version ||
      data.docs !== "/api/openapi.yaml"
    )
      throw new Error("Unexpected API metadata.");
  }

  await check("API liveness", async () => {
    if ((await (await get(api, "/health")).json()).status !== "ok")
      throw new Error("Not live.");
  });
  await check("Postgres/schema/runtime-role readiness", async () => {
    if ((await (await get(api, "/ready")).json()).status !== "ready")
      throw new Error("Not ready.");
  });
  await check("API version", () => metadata(api));
  await check("Frontend proxy version", () => metadata(web));
  await check("Published OpenAPI matches checkout", async () => {
    if ((await (await get(api, "/api/openapi.yaml")).text()) !== contract)
      throw new Error("Contract drift.");
  });
  await check("Unauthenticated access is denied", async () => {
    const response = await get(api, "/api/auth/me", 401);
    const data = await response.json();
    if (
      data.error?.code !== "AUTH_REQUIRED" ||
      !data.error?.request_id ||
      !response.headers.get("cache-control")?.includes("no-store")
    )
      throw new Error("Unsafe auth contract.");
  });
  await check("Unknown API route has a JSON error", async () => {
    const response = await get(api, "/api/demo-preflight-not-a-route", 404);
    if ((await response.json()).error?.code !== "RESOURCE_NOT_FOUND")
      throw new Error("Unexpected routing.");
  });
  await check("Matching feature-only Go/WASM assets", async () => {
    const manifest = await (
      await get(web, "/wasm/signalgen_core.manifest.json")
    ).json();
    if (
      manifest.engine_version !== "core-0.4.0" ||
      manifest.schema_version !== "signal-baseline-1" ||
      manifest.worker_protocol !== "worker-2" ||
      manifest.feature_schema_version !== "screener-features-1" ||
      manifest.capabilities_version !== "capabilities-3" ||
      manifest.wasm_file !== "signalgen_core.wasm" ||
      manifest.runtime_file !== "wasm_exec.js"
    )
      throw new Error("Unsupported worker manifest.");
    const wasm = Buffer.from(
      await (await get(web, "/wasm/signalgen_core.wasm")).arrayBuffer(),
    );
    const runtime = Buffer.from(
      await (await get(web, "/wasm/wasm_exec.js")).arrayBuffer(),
    );
    verifyArtifact(wasm, manifest.wasm_sha256, manifest.wasm_bytes);
    verifyArtifact(runtime, manifest.runtime_sha256, manifest.runtime_bytes);
    // These known marker checks are regression guards, not proof of absolute
    // anti-reverse-engineering or evidence that all private logic is hidden.
    if (
      !wasm.includes(Buffer.from("signalgenComputeFeatures")) ||
      ["signalgenRunSignals", "Default Scalping", "RULE_MATCHED"].some(
        (marker) => wasm.includes(Buffer.from(marker)),
      )
    )
      throw new Error("Unexpected decision markers in distributed WASM.");
  });
  return results;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2) throw new Error("Two local origins are required.");
    const contract = await readFile(
      new URL("../openapi.yaml", import.meta.url),
      "utf8",
    );
    const results = await runPreflight({
      api: args[0],
      web: args[1],
      contract,
    });
    for (const result of results)
      console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}`);
    console.log(
      "Read-only preflight only: real login, ownership and screening still need separate tests.",
    );
    process.exitCode = results.every((result) => result.passed) ? 0 : 1;
  } catch {
    console.error(
      "Usage: node backend/scripts/demo_preflight.mjs http://127.0.0.1:8080 http://127.0.0.1:5174",
    );
    console.error(
      "No credentials or response bodies are printed. Check the local origins and OpenAPI file.",
    );
    process.exitCode = 1;
  }
}
