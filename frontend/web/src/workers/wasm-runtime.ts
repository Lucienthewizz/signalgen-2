/// <reference lib="webworker" />

type GoRuntime = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};

type WasmManifest = {
  engine_version: string;
  schema_version: string;
  feature_schema_version: string;
  capabilities_version: string;
  worker_protocol: string;
  wasm_file: string;
  runtime_file: string;
  wasm_sha256: string;
  runtime_sha256: string;
};

export type WorkerScope = typeof globalThis & {
  Go?: new () => GoRuntime;
  signalgenComputeFeatures?: (request: string) => string;
  signalgenComputeBacktestFeatures?: (request: string) => string;
  signalgenRunBacktest?: (request: string) => string;
  signalgenBacktestCapabilities?: () => string;
};

const scope = self as WorkerScope;

export async function loadEngine(): Promise<WorkerScope> {
  const base = new URL("/wasm/", self.location.origin);
  const manifestResponse = await fetch(
    new URL("signalgen_core.manifest.json", base),
  );
  if (!manifestResponse.ok) throw new Error("WASM manifest not found");
  const manifest = (await manifestResponse.json()) as WasmManifest;
  if (
    manifest.engine_version !== "core-0.4.0" ||
    manifest.worker_protocol !== "worker-2" ||
    manifest.feature_schema_version !== "screener-features-1"
  )
    throw new Error("Unsupported WASM worker version");

  const [runtimeResponse, wasmResponse] = await Promise.all([
    fetch(new URL(manifest.runtime_file, base)),
    fetch(new URL(manifest.wasm_file, base)),
  ]);
  if (!runtimeResponse.ok || !wasmResponse.ok)
    throw new Error("Go/WASM artifacts are incomplete");
  const runtimeBytes = await runtimeResponse.arrayBuffer();
  const wasmBytes = await wasmResponse.arrayBuffer();
  await Promise.all([
    verifyHash(runtimeBytes, manifest.runtime_sha256),
    verifyHash(wasmBytes, manifest.wasm_sha256),
  ]);

  const runtimeURL = URL.createObjectURL(
    new Blob([runtimeBytes], { type: "text/javascript" }),
  );
  try {
    await import(/* @vite-ignore */ runtimeURL);
  } finally {
    URL.revokeObjectURL(runtimeURL);
  }
  if (!scope.Go) throw new Error("The Go runtime could not be loaded");
  const go = new scope.Go();
  const instantiated = await WebAssembly.instantiate(
    wasmBytes,
    go.importObject,
  );
  void go.run(instantiated.instance);
  if (!scope.signalgenComputeFeatures)
    throw new Error("The WASM feature function could not be initialized");
  return scope;
}

async function verifyHash(
  content: ArrayBuffer,
  expected: string,
): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", content);
  const actual = `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  if (actual !== expected) throw new Error("Go/WASM artifact hash mismatch");
}
