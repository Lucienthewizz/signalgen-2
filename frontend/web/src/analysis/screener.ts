import { api, ApiError, websocketURL } from "@/api/client";
import type {
  DatasetContent,
  DatasetManifest,
  ScreenerDecision,
  ScreenerFeatureResult,
  ScreenerFeatureVector,
  ScreenerResult,
} from "@/types";

export type ScreenerStage =
  "validating_access" | "preparing_data" | "loading_engine" | "private_scoring";

export type LiveScreenerRun = {
  result: ScreenerResult;
  latestDecision: ScreenerDecision;
  features: ScreenerFeatureVector;
  manifest: DatasetManifest;
  latestClose: number;
  execution: "client_wasm+server_private_scoring";
};

const BASELINE_RULE_ID = "default-scalping-v1";

export async function runLiveScreener(
  signal: AbortSignal,
  onStage: (stage: ScreenerStage) => void,
): Promise<LiveScreenerRun> {
  onStage("validating_access");
  await api.ensureAppSession();

  onStage("preparing_data");
  const [manifest, rule] = await Promise.all([
    api.prepareDataset(),
    api.getRule(BASELINE_RULE_ID),
  ]);
  const dataset = await api.getDatasetContent(manifest.dataset_id);

  onStage("loading_engine");
  const featureResult = await extractFeaturesWithWasm(dataset, signal);
  const latestCandidate = featureResult.candidates.at(-1);
  if (!latestCandidate)
    throw new ApiError(
      "WASM tidak menghasilkan kandidat yang dapat dinilai.",
      0,
    );

  onStage("private_scoring");
  const grant = await api.createComputeGrant(manifest, rule);
  const ticket = await api.createScreenerSocketTicket(grant.id);
  if (
    featureResult.feature_schema_version !== ticket.feature_schema_version ||
    featureResult.candidates.length > ticket.max_candidates
  )
    throw new ApiError(
      "Hasil WASM tidak cocok dengan batas private scoring.",
      0,
    );
  const result = await evaluateOverSocket(
    ticket.websocket_path,
    ticket.ticket,
    ticket.protocol,
    ticket.feature_schema_version,
    featureResult,
    signal,
  );
  const latestDecision = result.results.at(-1);
  if (!latestDecision)
    throw new ApiError("Server tidak mengembalikan hasil private scoring.", 0);

  return {
    result,
    latestDecision,
    features: latestCandidate.features,
    manifest,
    latestClose: dataset.candles.at(-1)?.close ?? 0,
    execution: "client_wasm+server_private_scoring",
  };
}

function extractFeaturesWithWasm(
  dataset: DatasetContent,
  signal: AbortSignal,
): Promise<ScreenerFeatureResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/screener.worker.ts", import.meta.url),
      { type: "module", name: "signalgen-screener" },
    );
    const jobId = crypto.randomUUID();
    const timeout = window.setTimeout(
      () => finishError("WASM tidak siap dalam 15 detik."),
      15000,
    );

    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancelled);
      worker.terminate();
    }
    function finishError(message: string) {
      cleanup();
      reject(new ApiError(message, 0));
    }
    function cancelled() {
      finishError("Analisis dibatalkan.");
    }
    signal.addEventListener("abort", cancelled, { once: true });
    worker.onerror = () => finishError("Worker Go/WASM gagal dimuat.");
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        type: "result" | "error";
        jobId: string;
        features?: ScreenerFeatureResult;
        message?: string;
      };
      if (message.jobId !== jobId) return;
      if (message.type === "error" || !message.features) {
        finishError(message.message ?? "WASM gagal menghitung indikator.");
        return;
      }
      cleanup();
      resolve(message.features);
    };
    worker.postMessage({
      type: "extract",
      jobId,
      symbol: dataset.symbol,
      candles: dataset.candles,
    });
  });
}

function evaluateOverSocket(
  path: string,
  ticket: string,
  protocol: "screener-private-1",
  featureSchemaVersion: "screener-features-1",
  featureResult: ScreenerFeatureResult,
  signal: AbortSignal,
): Promise<ScreenerResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketURL(path, ticket));
    const requestId = crypto.randomUUID();
    let settled = false;
    const timeout = window.setTimeout(
      () => finishError("Private scoring melewati batas waktu."),
      10000,
    );

    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancelled);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      )
        socket.close(1000, "completed");
    }
    function finishError(message: string) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ApiError(message, 0));
    }
    function cancelled() {
      finishError("Analisis dibatalkan.");
    }
    signal.addEventListener("abort", cancelled, { once: true });
    socket.onerror = () => finishError("Koneksi private scoring gagal.");
    socket.onclose = (event) => {
      if (!event.wasClean) finishError("Koneksi private scoring terputus.");
    };
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "screener.evaluate",
          protocol,
          request_id: requestId,
          engine_version: featureResult.engine_version,
          feature_schema_version: featureSchemaVersion,
          candidates: featureResult.candidates,
        }),
      );
    };
    socket.onmessage = (event) => {
      let payload:
        ScreenerResult | { type: "screener.error"; message?: string };
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        finishError("Respons private scoring tidak valid.");
        return;
      }
      if (payload.type === "screener.error") {
        finishError(payload.message ?? "Private scoring ditolak.");
        return;
      }
      if (payload.type !== "screener.result") return;
      if (
        payload.request_id !== requestId ||
        payload.protocol !== protocol ||
        !Array.isArray(payload.results)
      ) {
        finishError("Respons private scoring tidak cocok dengan request.");
        return;
      }
      settled = true;
      cleanup();
      resolve(payload as ScreenerResult);
    };
  });
}
