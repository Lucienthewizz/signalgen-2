import type { BacktestManifest, BacktestDataset } from "./backtest-types";

export const STUDY_SCHEMA = "signal-study-1";
export const STUDY_POLICY = "signal-close-independent-1";
export type StudyConfig = {
  from: string;
  to: string;
  n_steps: number;
  take_profit_pct?: number;
  stop_loss_pct?: number;
};
export type StudyInput = {
  purpose?: "screen" | "backtest";
  source: "market" | "universe";
  market: "IDX" | "US";
  universe_id?: string;
  rule_id: string;
  config: StudyConfig;
};
export type StudyContext = {
  source?: "market" | "universe";
  universe_id?: string;
  purpose?: "screen" | "backtest";
  engine_version: string;
  rule_schema_version: string;
  id: string;
  schema_version: string;
  policy_version: string;
  market: "IDX" | "US";
  currency: string;
  config: StudyConfig;
  rule_id: string;
  definition_hash: string;
  catalog_hash: string;
  total: number;
  batch_size: number;
  batches: number;
  expires_at: string;
};
export type StudyManifest = Omit<BacktestManifest, "purpose"> & {
  purpose: "screen" | "backtest";
  backtest: BacktestManifest["backtest"] & {
    study_id: string;
    definition_hash: string;
  };
};
export type StudyBatch = {
  index: number;
  stocks: string[];
  manifests: StudyManifest[];
  failures: Array<{ symbol: string; code: string; retryable: boolean }>;
};
export type StudyEntry = {
  symbol: string;
  timestamp: string;
  signal_type: "BUY" | "SELL";
};
export type StudyMetrics = {
  // Optional additive window counter; absent for no TP and legacy engines.
  target_hits?: number;
  signals: number;
  evaluated: number;
  missing: number;
  wins: number;
  losses: number;
  flats: number;
  sum_return_pct: number;
  mean_return_pct: number | null;
  win_rate: number | null;
};
export type StudyOutcome = {
  basis: string;
  step: number;
  status: string;
  price: number | null;
  return_pct: number | null;
  timestamp?: string;
};
export type StudyEvent = StudyEntry & {
  reference_price: number;
  outcomes: StudyOutcome[];
  swing: StudyOutcome;
};
export type StudyResult = {
  schema_version: string;
  policy_version: string;
  config: StudyConfig;
  events: StudyEvent[];
  horizons: Array<StudyMetrics & { step: number; basis: string }>;
  swing: StudyMetrics;
  by_symbol: Array<StudyMetrics & { key: string }>;
  by_day: Array<StudyMetrics & { key: string }>;
  warnings: string[];
};
export type StudyRequest = {
  schema_version: string;
  config: StudyConfig;
  series: BacktestDataset["series"];
  entries: StudyEntry[];
};

export const emptyStudyMetrics = (): StudyMetrics => ({
  signals: 0,
  evaluated: 0,
  missing: 0,
  wins: 0,
  losses: 0,
  flats: 0,
  sum_return_pct: 0,
  mean_return_pct: null,
  win_rate: null,
});
export function mergeStudyMetrics(
  a: StudyMetrics,
  b: StudyMetrics,
): StudyMetrics {
  const out = { ...a };
  for (const key of [
    "signals",
    "evaluated",
    "missing",
    "wins",
    "losses",
    "flats",
    "sum_return_pct",
  ] as const)
    out[key] += b[key];
  // An empty accumulator contributes no unknown observations. A nonempty legacy
  // part without counters makes the combined target rate unavailable.
  if (
    (a.target_hits != null || a.signals === 0) &&
    (b.target_hits != null || b.signals === 0) &&
    (a.target_hits != null || b.target_hits != null)
  )
    out.target_hits = (a.target_hits ?? 0) + (b.target_hits ?? 0);
  else delete out.target_hits;
  out.mean_return_pct = out.evaluated
    ? out.sum_return_pct / out.evaluated
    : null;
  out.win_rate = out.evaluated ? (out.wins / out.evaluated) * 100 : null;
  return out;
}
