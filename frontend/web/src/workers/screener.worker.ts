/// <reference lib="webworker" />

import type { Candle, ScreenerFeatureResult } from "@/types";

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

type WorkerScope = typeof globalThis & {
  Go?: new () => GoRuntime;
  signalgenComputeFeatures?: (request: string) => string;
};

const scope = self as WorkerScope;
let ready: Promise<void> | null = null;

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as {
    type: "extract";
    jobId: string;
    symbol: string;
    candles: Candle[];
  };
  if (message.type !== "extract") return;
  try {
    ready ??= loadEngine();
    await ready;
    const encoded = scope.signalgenComputeFeatures?.(
      JSON.stringify({
        purpose: "screen",
        symbol: message.symbol,
        candles: message.candles,
      }),
    );
    if (!encoded) throw new Error("WASM feature function is unavailable");
    const response = JSON.parse(encoded) as {
      ok: boolean;
      result?: ScreenerFeatureResult;
      error?: { message?: string };
    };
    if (!response.ok || !response.result)
      throw new Error(response.error?.message ?? "Feature extraction failed");
    self.postMessage({
      type: "result",
      jobId: message.jobId,
      features: response.result,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      jobId: message.jobId,
      message: error instanceof Error ? error.message : "Unknown WASM error",
    });
  }
};

async function loadEngine(): Promise<void> {
  const base = new URL("/wasm/", self.location.origin);
  const manifestResponse = await fetch(
    new URL("signalgen_core.manifest.json", base),
  );
  if (!manifestResponse.ok) throw new Error("WASM manifest tidak ditemukan");
  const manifest = (await manifestResponse.json()) as WasmManifest;
  if (
    manifest.engine_version !== "core-0.3.0" ||
    manifest.worker_protocol !== "worker-2" ||
    manifest.feature_schema_version !== "screener-features-1"
  )
    throw new Error("Versi worker WASM tidak didukung");

  const [runtimeResponse, wasmResponse] = await Promise.all([
    fetch(new URL(manifest.runtime_file, base)),
    fetch(new URL(manifest.wasm_file, base)),
  ]);
  if (!runtimeResponse.ok || !wasmResponse.ok)
    throw new Error("Artifact Go/WASM tidak lengkap");
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
  if (!scope.Go) throw new Error("Go runtime gagal dimuat");
  const go = new scope.Go();
  const instantiated = await WebAssembly.instantiate(
    wasmBytes,
    go.importObject,
  );
  void go.run(instantiated.instance);
  if (!scope.signalgenComputeFeatures)
    throw new Error("WASM feature function gagal diinisialisasi");
}

async function verifyHash(
  content: ArrayBuffer,
  expected: string,
): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", content);
  const actual = `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  if (actual !== expected) throw new Error("Hash artifact Go/WASM tidak cocok");
}

export {};
