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
        "Komputasi lain masih berjalan. Tunggu atau batalkan terlebih dahulu.",
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
      () => finishError("Komputasi Go/WASM melewati batas 45 detik."),
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
      finishError("Analisis dibatalkan.");
    }
    activeCancel = cancelled;
    signal.addEventListener("abort", cancelled, { once: true });
    engine.onerror = () => finishError("Worker Go/WASM gagal dimuat.");
    engine.onmessageerror = () =>
      finishError("Respons worker Go/WASM tidak dapat dibaca.");
    engine.onmessage = (event) => {
      const message = event.data;
      if (!message || message.jobId !== jobId || settled) return;
      if (message.type === "error") {
        finishError(message.message ?? "WASM gagal menghitung indikator.");
        return;
      }
      if (
        message.type !== "result" ||
        !Array.isArray(message.results) ||
        message.results.length !== series.length
      ) {
        finishError("Respons batch worker tidak cocok dengan dataset.");
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
      finishError("Dataset tidak dapat dikirim ke worker.");
    }
  });
}
