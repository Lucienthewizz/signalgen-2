import { ApiError, websocketURL } from "@/api/client";
import type { ScreenerFeatureResult, ScreenerResult } from "@/types";

export function evaluateOverSocket(
  path: string,
  ticket: string,
  protocol: "screener-private-1",
  featureSchemaVersion: "screener-features-1",
  featureResult: ScreenerFeatureResult,
  signal: AbortSignal,
): Promise<ScreenerResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketURL(path, ticket));
    const requestId = crypto.randomUUID();
    let settled = false;
    const timeout = window.setTimeout(
      () => finishError("Scoring timed out."),
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
      finishError("Analysis cancelled.");
    }
    signal.addEventListener("abort", cancelled, { once: true });
    socket.onerror = () => finishError("The scoring connection failed.");
    socket.onclose = (event) => {
      finishError("The scoring connection closed before all results arrived.");
    };
    socket.onopen = () => {
      if (signal.aborted) {
        cancelled();
        return;
      }
      try {
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
      } catch {
        finishError("Candidates could not be sent for scoring.");
      }
    };
    socket.onmessage = (event) => {
      let payload:
        ScreenerResult | { type: "screener.error"; message?: string };
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        finishError("The scoring response is invalid.");
        return;
      }
      if (!payload || typeof payload !== "object") {
        finishError("The scoring response is invalid.");
        return;
      }
      if (payload.type === "screener.error") {
        finishError(payload.message ?? "Scoring was denied.");
        return;
      }
      if (payload.type !== "screener.result") return;
      if (
        payload.request_id !== requestId ||
        payload.protocol !== protocol ||
        typeof payload.decision_version !== "string" ||
        !Array.isArray(payload.results) ||
        payload.results.length !== featureResult.candidates.length ||
        !payload.results.every(
          (row, index) =>
            row &&
            row.symbol === featureResult.candidates[index].symbol &&
            row.timestamp === featureResult.candidates[index].timestamp &&
            typeof row.matched === "boolean" &&
            Array.isArray(row.reason_codes) &&
            row.reason_codes.every((code) => typeof code === "string"),
        )
      ) {
        finishError("The scoring response does not match this request.");
        return;
      }
      settled = true;
      cleanup();
      resolve(payload as ScreenerResult);
    };
  });
}
