// Test-only host for the exact Go/WASM bridge used by Model A. No credentials,
// network access, or private decision rule enters this process.
const fs = require("node:fs");
require(process.argv[2]);

async function main() {
  const series = JSON.parse(fs.readFileSync(0, "utf8"));
  const go = new Go();
  const { instance } = await WebAssembly.instantiate(
    fs.readFileSync(process.argv[3]), go.importObject,
  );
  const running = go.run(instance);
  running.catch((error) => { console.error(error.message); process.exit(1); });
  if (typeof globalThis.signalgenComputeFeatures !== "function")
    throw new Error("Go/WASM feature bridge is missing");
  if (typeof globalThis.signalgenEvaluateDecision === "function")
    throw new Error("Private decision bridge must not be exposed to WASM");
  const capabilities = JSON.parse(globalThis.signalgenCapabilities());
  const results = series.map(({ symbol, candles }) => {
    const response = JSON.parse(globalThis.signalgenComputeFeatures(JSON.stringify({
      purpose: "screen", symbol, candles,
    })));
    if (!response.ok || !response.result) throw new Error("Go/WASM computation failed");
    if (response.result.engine_version !== capabilities.engine_version ||
        response.result.feature_schema_version !== capabilities.feature_schema_version)
      throw new Error("WASM capability and feature versions differ");
    return response.result;
  });
  process.stdout.write(JSON.stringify(results), () => process.exit(0));
}
main().catch((error) => { console.error(error.message); process.exit(1); });
