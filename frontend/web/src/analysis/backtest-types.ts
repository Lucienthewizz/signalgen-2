import type {
  Candle,
  ComputeGrant,
  DatasetContent,
  DatasetManifest,
} from "@/types";

export const BACKTEST_SCHEMA = "backtest-1";
export const BACKTEST_POLICY = "holding-next-open-1";
export type BacktestConfig = {
  mode: "rule" | "manual";
  timeframe: "1d";
  from: string;
  to: string;
  n_steps: number;
  exit_strategy: "holding_period";
  initial_capital: number;
  position_sizing: "percent_equity" | "fixed_amount";
  position_size: number;
  commission_pct: number;
  slippage_pct: number;
};
export type BacktestEntry = {
  symbol: string;
  timestamp: string;
  signal_type: "BUY";
};
export type BacktestScope = Pick<
  BacktestConfig,
  "mode" | "from" | "to" | "n_steps"
> & { rule_id?: string };
export type BacktestManifest = Omit<
  DatasetManifest,
  "purpose" | "timeframe" | "quality"
> & {
  purpose: "backtest";
  timeframe: "1d";
  backtest: BacktestScope;
  quality: { status: "complete" | "partial"; warnings: string[] };
};
export type BacktestDataset = Omit<DatasetContent, "purpose" | "timeframe"> & {
  purpose: "backtest";
  timeframe: "1d";
  backtest: BacktestScope;
};
export type BacktestCapabilities = {
  schema_version: string;
  policy_version: string;
  max_symbols: number;
  max_candles_per_symbol: number;
  max_entries: number;
  max_horizon: number;
};
export type BacktestGrant = Omit<ComputeGrant, "purpose"> & {
  purpose: "backtest";
};
export type BacktestTrade = {
  symbol: string;
  signal_time: string;
  entry_time: string;
  exit_time?: string;
  status: "open" | "closed";
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  entry_commission: number;
  exit_commission: number;
  net_pl: number;
  unrealized_pl: number;
  return_pct: number;
};
export type BacktestMetrics = {
  initial_capital: number;
  final_equity: number;
  net_pl_cash: number;
  unrealized_pl: number;
  total_return_pct: number;
  closed_trades: number;
  open_trades: number;
  wins: number;
  losses: number;
  flats: number;
  win_rate: number;
  profit_factor: number | null;
  max_drawdown_pct: number;
  total_commission: number;
};
export type BacktestHorizon = {
  step: number;
  label: string;
  trades: BacktestTrade[];
  skipped: Array<BacktestEntry & { reason: string }>;
  metrics: BacktestMetrics;
  equity_curve: Array<{ timestamp: string; equity: number }>;
};
export type BacktestRequest = {
  schema_version: typeof BACKTEST_SCHEMA;
  config: BacktestConfig;
  series: Array<{ symbol: string; timezone: "UTC"; candles: Candle[] }>;
  entries: BacktestEntry[];
};
export type BacktestResult = {
  schema_version: typeof BACKTEST_SCHEMA;
  policy_version: typeof BACKTEST_POLICY;
  execution: "portable_go_backtest";
  config: BacktestConfig;
  horizons: BacktestHorizon[];
  warnings: string[];
};
