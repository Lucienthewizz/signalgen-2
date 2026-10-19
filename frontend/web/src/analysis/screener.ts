import { api, ApiError } from "@/api/client";
import { extractDatasetFeatures } from "./screener-engine";
import { packCandidateBatches } from "./screener-batches";
import { evaluateOverSocket } from "./screener-socket";
import { universeSelectionLimit } from "@/lib/stock-catalog";
import { loadScreenerDataset } from "./screener-dataset";
import { CACHE_RESET_EVENT } from "../data/historical-cache";
import type {
  DatasetManifest,
  ScreenerDecision,
  ScreenerFeatureVector,
  ScreenerResult,
  RuleResource,
} from "@/types";

export type ScreenerStage =
  "validating_access" | "preparing_data" | "loading_engine" | "private_scoring";
export type LiveScreenerRun = {
  ruleSnapshot?: RuleResource;
  result: ScreenerResult;
  latestDecision: ScreenerDecision;
  features: ScreenerFeatureVector;
  manifest: DatasetManifest;
  latestClose: number;
  latestOpen: number | null;
  rows: Array<{
    decision: ScreenerDecision;
    features: ScreenerFeatureVector;
    latestClose: number;
    latestOpen: number | null;
  }>;
  execution: "client_wasm+server_private_scoring";
  metrics?: {
    feature_ms: number;
    scoring_ms: number;
    total_ms: number;
    stocks: number;
    candidates: number;
    sockets: number;
  };
};

function ensureNotCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new ApiError("Analysis cancelled.", 0);
}

export async function runLiveScreener(
  ruleId: string,
  universeId: string,
  signal: AbortSignal,
  onStage: (stage: ScreenerStage) => void,
): Promise<LiveScreenerRun> {
  // A logout/clear in this or another tab cancels network/worker/socket continuations.
  const lifetime = new AbortController();
  const cancel = () => lifetime.abort();
  signal.addEventListener("abort", cancel, { once: true });
  window.addEventListener(CACHE_RESET_EVENT, cancel);
  if (signal.aborted) lifetime.abort();
  try {
    return await runAuthorizedScreener(
      ruleId,
      universeId,
      lifetime.signal,
      onStage,
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    window.removeEventListener(CACHE_RESET_EVENT, cancel);
  }
}

async function runAuthorizedScreener(
  ruleId: string,
  universeId: string,
  signal: AbortSignal,
  onStage: (stage: ScreenerStage) => void,
): Promise<LiveScreenerRun> {
  ensureNotCancelled(signal);
  const start = performance.now();
  onStage("validating_access");
  await api.ensureAppSession();
  ensureNotCancelled(signal);
  onStage("preparing_data");
  const [manifest, rule] = await Promise.all([
    api.prepareDataset(ruleId, universeId),
    api.getRule(ruleId),
  ]);
  const dataset = await loadScreenerDataset(manifest, signal);
  ensureNotCancelled(signal);
  if (!dataset.series.length || dataset.series.length > universeSelectionLimit)
    throw new ApiError(
      "The dataset must contain 1–10 stocks for analysis.",
      0,
    );

  onStage("loading_engine");
  const featureStart = performance.now();
  const featureRuns = await extractDatasetFeatures(dataset.series, signal);
  ensureNotCancelled(signal);
  const featureMs = performance.now() - featureStart;
  // Reject corrupt/empty feature groups before consuming an access grant.
  packCandidateBatches(featureRuns, 1000);
  onStage("private_scoring");
  const scoringStart = performance.now();
  const grant = await api.createComputeGrant(manifest, rule);
  ensureNotCancelled(signal);
  let ticket = await api.createScreenerSocketTicket(grant.id);
  ensureNotCancelled(signal);
  let batches;
  try {
    batches = packCandidateBatches(featureRuns, ticket.max_candidates);
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "Invalid screening batch.",
      0,
    );
  }
  if (!batches.length) throw new ApiError("No screening candidates found.", 0);
  const results: ScreenerResult[] = [];
  for (const [index, featureResult] of batches.entries()) {
    ensureNotCancelled(signal);
    if (index > 0) ticket = await api.createScreenerSocketTicket(grant.id);
    ensureNotCancelled(signal);
    if (
      ticket.feature_schema_version !== featureResult.feature_schema_version ||
      featureResult.candidates.length > ticket.max_candidates
    )
      throw new ApiError(
        "WASM results do not match the scoring limits.",
        0,
      );
    results.push(
      await evaluateOverSocket(
        ticket.websocket_path,
        ticket.ticket,
        ticket.protocol,
        ticket.feature_schema_version,
        featureResult,
        signal,
      ),
    );
  }
  const result = {
    ...results[0],
    results: results.flatMap((batch) => batch.results),
  };
  const decisions = new Map(
    result.results.map((decision) => [
      `${decision.symbol}\u0000${decision.timestamp}`,
      decision,
    ]),
  );
  const rows = dataset.series.map((series, index) => {
    const latest = featureRuns[index]?.candidates.at(-1);
    const decision =
      latest && decisions.get(`${latest.symbol}\u0000${latest.timestamp}`);
    if (!latest || !decision || latest.symbol !== series.symbol)
      throw new ApiError(
        `Screening results for ${series.symbol} are incomplete.`,
        0,
      );
    return {
      decision,
      features: latest.features,
      latestClose: series.candles.at(-1)?.close ?? 0,
      latestOpen: series.candles.at(-1)?.open ?? null,
    };
  });
  return {
    ruleSnapshot: rule,
    result,
    latestDecision: rows[0].decision,
    features: rows[0].features,
    manifest,
    latestClose: rows[0].latestClose,
    latestOpen: rows[0].latestOpen,
    rows,
    execution: "client_wasm+server_private_scoring",
    metrics: {
      feature_ms: featureMs,
      scoring_ms: performance.now() - scoringStart,
      total_ms: performance.now() - start,
      stocks: rows.length,
      candidates: result.results.length,
      sockets: batches.length,
    },
  };
}
