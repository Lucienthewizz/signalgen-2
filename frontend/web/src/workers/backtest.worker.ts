/// <reference lib="webworker" />
import { loadEngine } from "./wasm-runtime";
import { BACKTEST_POLICY, BACKTEST_SCHEMA } from "@/analysis/backtest-types";
import type { BacktestRequest } from "@/analysis/backtest-types";
import type { DatasetContent } from "@/types";

let ready: ReturnType<typeof loadEngine> | null = null;
self.onmessage = async (event: MessageEvent) => {
  const message = event.data as {
    jobId: string;
    operands?: string[];
    type: "features" | "simulate";
    series?: DatasetContent["series"];
    request?: BacktestRequest;
  };
  try {
    ready ??= loadEngine();
    const engine = await ready;
    const capabilities = engine.signalgenBacktestCapabilities?.();
    if (
      !capabilities ||
      !engine.signalgenRunBacktest ||
      !engine.signalgenComputeBacktestFeatures
    )
      throw new Error(
        "The WASM build has no backtesting support. Rebuild the frontend WASM artifacts.",
      );
    const version = JSON.parse(capabilities);
    if (
      version.schema_version !== BACKTEST_SCHEMA ||
      version.policy_version !== BACKTEST_POLICY
    )
      throw new Error(
        "The backtest engine version is not supported. Rebuild the WASM assets and refresh the app.",
      );
    function decode(encoded: string) {
      const response = JSON.parse(encoded);
      if (!response.ok || !response.result)
        throw new Error(
          response.error?.message ?? "Backtest computation failed.",
        );
      return response.result;
    }
    let result;
    if (message.type === "features" && Array.isArray(message.series)) {
      result = message.series.map((item) =>
        decode(
          engine.signalgenComputeBacktestFeatures!(
            JSON.stringify({
              purpose: "backtest",
              symbol: item.symbol,
              candles: item.candles,
              operands: message.operands,
            }),
          ),
        ),
      );
    } else if (message.type === "simulate" && message.request) {
      result = decode(
        engine.signalgenRunBacktest(JSON.stringify(message.request)),
      );
    } else throw new Error("Invalid backtest worker request.");
    self.postMessage({ type: "result", jobId: message.jobId, result });
  } catch (error) {
    self.postMessage({
      type: "error",
      jobId: message.jobId,
      message:
        error instanceof Error ? error.message : "Backtest computation failed.",
    });
  }
};
export {};
