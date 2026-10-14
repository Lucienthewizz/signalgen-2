import { ApiError } from "@/api/client";
import type { DatasetContent, ScreenerFeatureResult } from "@/types";

let worker: Worker | null = null;
let activeCancel: (() => void) | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function reset() {
  clearTimeout(idleTimer);
  worker?.terminate();
  worker = null;
}
export function disposeScreenerEngine() {
  activeCancel?.();
  reset();
}
if (typeof window !== "undefined")
  window.addEventListener("pagehide", disposeScreenerEngine);

/** Public engine only is reused. Each job drops its candle/result references. */
export function extractDatasetFeatures(
  series: DatasetContent["series"],
  signal: AbortSignal,
): Promise<ScreenerFeatureResult[]> {
  signal.throwIfAborted();
  if (activeCancel)
    return Promise.reject(
      new ApiError(
        "Another computation is running. Wait for it to finish or cancel it first.",
        0,
      ),
    );
  clearTimeout(idleTimer);
  worker ??= new Worker(
    new URL("../workers/screener.worker.ts", import.meta.url),
    { type: "module", name: "signalgen-screener" },
  );
  const engine = worker;
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID();
    let settled = false;
    const timeout = setTimeout(
      () => finishError("Go/WASM computation exceeded the 45-second limit."),
      45000,
    );
    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancelled);
      engine.onmessage = null;
      engine.onerror = null;
      engine.onmessageerror = null;
      activeCancel = null;
    }
    function finishError(message: string) {
      if (settled) return;
      settled = true;
      cleanup();
      reset();
      reject(new ApiError(message, 0));
    }
    function cancelled() {
      finishError("Analysis cancelled.");
    }
    activeCancel = cancelled;
    signal.addEventListener("abort", cancelled, { once: true });
    engine.onerror = () => finishError("The Go/WASM worker could not be loaded.");
    engine.onmessageerror = () =>
      finishError("The Go/WASM worker response could not be read.");
    engine.onmessage = (event) => {
      const message = event.data;
      if (!message || message.jobId !== jobId || settled) return;
      if (message.type === "error") {
        finishError(message.message ?? "WASM could not calculate indicators.");
        return;
      }
      if (
        message.type !== "result" ||
        !Array.isArray(message.results) ||
        message.results.length !== series.length
      ) {
        finishError("The worker batch response does not match the dataset.");
        return;
      }
      settled = true;
      cleanup();
      idleTimer = setTimeout(reset, 60000);
      resolve(message.results);
    };
    try {
      engine.postMessage({ type: "extract-batch", jobId, series });
    } catch {
      finishError("The dataset could not be sent to the worker.");
    }
  });
}
