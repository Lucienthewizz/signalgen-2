import { ApiError } from "@/api/client";
import type { BacktestRequest, BacktestResult } from "./backtest-types";
import type { DatasetContent, ScreenerFeatureResult } from "@/types";

function job<T>(payload: object, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const worker = new Worker(
    new URL("../workers/backtest.worker.ts", import.meta.url),
    { type: "module", name: "signalgen-backtest" },
  );
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID();
    let settled = false;
    const timer = setTimeout(
      () =>
        finish(
          new ApiError("Backtest computation exceeded the 60-second limit.", 0),
        ),
      60000,
    );
    const cancel = () =>
      finish(new DOMException("Backtest cancelled.", "AbortError"));
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
    }
    function finish(error: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () =>
      finish(new ApiError("The backtest worker could not be loaded.", 0));
    worker.onmessageerror = () =>
      finish(new ApiError("The backtest result could not be read.", 0));
    worker.onmessage = ({ data }) => {
      if (settled || data?.jobId !== jobId) return;
      if (data.type !== "result" || !data.result) {
        finish(new ApiError(data.message ?? "Backtest computation failed.", 0));
        return;
      }
      settled = true;
      cleanup();
      resolve(data.result as T);
    };
    try {
      worker.postMessage({ ...payload, jobId });
    } catch {
      finish(
        new ApiError("The backtest input could not be sent to the worker.", 0),
      );
    }
  });
}
export const extractBacktestFeatures = (
  series: DatasetContent["series"],
  signal: AbortSignal,
) => job<ScreenerFeatureResult[]>({ type: "features", series }, signal);
export const simulateBacktest = (
  request: BacktestRequest,
  signal: AbortSignal,
) => job<BacktestResult>({ type: "simulate", request }, signal);
