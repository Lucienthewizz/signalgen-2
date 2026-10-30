/// <reference lib="webworker" />

import type { Candle, ScreenerFeatureResult } from "@/types";

import { loadEngine, type WorkerScope } from "./wasm-runtime";
let ready: Promise<WorkerScope> | null = null;

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as {
    type: "extract" | "extract-batch";
    jobId: string;
    operands?: string[];
    symbol: string;
    candles: Candle[];
    series?: Array<{ symbol: string; candles: Candle[] }>;
  };
  if (!["extract", "extract-batch"].includes(message.type)) return;
  try {
    const cold = ready === null;
    const start = performance.now();
    ready ??= loadEngine();
    const scope = await ready;
    const initialized = performance.now();
    const series =
      message.type === "extract"
        ? [{ symbol: message.symbol, candles: message.candles }]
        : message.series;
    if (!Array.isArray(series) || !series.length)
      throw new Error("The dataset batch is empty");
    const results = series.map((item) => {
      const encoded = scope.signalgenComputeFeatures?.(
        JSON.stringify({
          purpose: "screen",
          symbol: item.symbol,
          candles: item.candles,
          operands: message.operands,
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
      return response.result;
    });
    self.postMessage({
      type: "result",
      jobId: message.jobId,
      timing: {
        startup_ms: cold ? initialized - start : 0,
        compute_ms: performance.now() - initialized,
        cold,
      },
      ...(message.type === "extract" ? { features: results[0] } : { results }),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      jobId: message.jobId,
      message: error instanceof Error ? error.message : "Unknown WASM error",
    });
  }
};

export {};
