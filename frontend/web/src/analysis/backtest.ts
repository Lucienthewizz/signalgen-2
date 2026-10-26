import { api, ApiError, session } from "@/api/client";
import { extractBacktestFeatures, simulateBacktest } from "./backtest-engine";
import { BACKTEST_POLICY, BACKTEST_SCHEMA } from "./backtest-types";
import type {
  BacktestConfig,
  BacktestDataset,
  BacktestEntry,
  BacktestManifest,
  BacktestScope,
} from "./backtest-types";

export type PreparedBacktest = {
  manifest: BacktestManifest;
  dataset: BacktestDataset;
  ownerId: string;
  revision: number;
  universeId: string;
};
export function backtestScope(
  config: BacktestConfig,
  ruleId: string,
): BacktestScope {
  return {
    mode: config.mode,
    from: config.from,
    to: config.to,
    n_steps: config.n_steps,
    ...(config.mode === "rule" ? { rule_id: ruleId } : {}),
  };
}
export function validateBacktestForm(config: BacktestConfig) {
  const from = Date.parse(`${config.from}T00:00:00Z`),
    to = Date.parse(`${config.to}T00:00:00Z`);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from > to ||
    to - from > 5 * 366 * 86400000 ||
    to > Date.now()
  )
    throw new ApiError(
      "Choose a valid historical date range of up to five years.",
      422,
    );
  if (
    !Number.isInteger(config.n_steps) ||
    config.n_steps < 1 ||
    config.n_steps > 100
  )
    throw new ApiError(
      "Holding period must be between 1 and 100 candles.",
      422,
    );
  for (const value of [
    config.initial_capital,
    config.position_size,
    config.commission_pct,
    config.slippage_pct,
  ])
    if (!Number.isFinite(value))
      throw new ApiError(
        "Enter valid numbers for capital, sizing and costs.",
        422,
      );
  if (
    config.initial_capital <= 0 ||
    config.initial_capital > 1e15 ||
    config.position_size <= 0 ||
    config.position_size >
      (config.position_sizing === "percent_equity" ? 100 : 1e15) ||
    config.commission_pct < 0 ||
    config.commission_pct > 10 ||
    config.slippage_pct < 0 ||
    config.slippage_pct > 10
  )
    throw new ApiError(
      "Check capital, position size and costs. Fee/slippage must be between 0% and 10%.",
      422,
    );
}
function check(signal: AbortSignal, revision: number) {
  signal.throwIfAborted();
  if (revision !== session.getIdentityRevision() || !session.getToken())
    throw new ApiError("Account changed. Start a new backtest.", 401);
}
async function access(signal: AbortSignal, revision: number) {
  await api.ensureAppSession();
  check(signal, revision);
  const [account, capability] = await Promise.all([
    api.account(signal),
    api.backtestCapabilities(signal),
  ]);
  check(signal, revision);
  if (!account.features.includes("backtest"))
    throw new ApiError(
      "Backtesting is not enabled for your account. Check Plan & access.",
      403,
      "ENTITLEMENT_REQUIRED",
    );
  if (
    capability.backtest?.schema_version !== BACKTEST_SCHEMA ||
    capability.backtest.policy_version !== BACKTEST_POLICY
  )
    throw new ApiError(
      "This backend does not support the current backtest version. Update the backend before running a backtest.",
      422,
      "UNSUPPORTED_CAPABILITY",
    );
  return account;
}
export async function prepareBacktest(
  config: BacktestConfig,
  ruleId: string,
  universeId: string,
  signal: AbortSignal,
  progress: (stage: string) => void,
): Promise<PreparedBacktest> {
  validateBacktestForm(config);
  if (!universeId || (config.mode === "rule" && !ruleId))
    throw new ApiError(
      "Choose a stock universe and a rule for rule mode.",
      422,
    );
  const revision = session.getIdentityRevision();
  progress("Checking access…");
  const account = await access(signal, revision);
  progress("Preparing historical data…");
  const scope = backtestScope(config, ruleId);
  const manifest = await api.prepareBacktest(scope, universeId, signal);
  check(signal, revision);
  if (
    manifest.purpose !== "backtest" ||
    manifest.timeframe !== "1d" ||
    manifest.schema_version !== "ohlcv-multi-1" ||
    !manifest.backtest ||
    !sameScope(manifest.backtest, scope) ||
    !Array.isArray(manifest.symbols) ||
    !manifest.symbols.length ||
    manifest.symbols.length > 10 ||
    manifest.decoded_bytes > 8 << 20
  )
    throw new ApiError(
      "The backtest snapshot does not match your selections.",
      409,
    );
  const text = await api.getDatasetContentText(manifest.dataset_id, signal);
  check(signal, revision);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 8 << 20 || bytes.length !== manifest.decoded_bytes)
    throw new ApiError("The historical snapshot has an invalid size.", 409);
  const hash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  check(signal, revision);
  if (hash !== manifest.checksum)
    throw new ApiError(
      "Historical data integrity check failed. Prepare the data again.",
      409,
    );
  const dataset = JSON.parse(text) as BacktestDataset;
  if (
    dataset.purpose !== "backtest" ||
    dataset.timeframe !== "1d" ||
    dataset.schema_version !== manifest.schema_version ||
    dataset.market !== manifest.market ||
    dataset.currency !== manifest.currency ||
    dataset.timezone !== "UTC" ||
    dataset.adjustment !== manifest.adjustment ||
    !dataset.backtest ||
    !sameScope(dataset.backtest, scope) ||
    !Array.isArray(dataset.series) ||
    dataset.series.length !== manifest.symbols.length
  )
    throw new ApiError(
      "The historical content does not match the manifest.",
      409,
    );
  const found = new Set<string>();
  for (const series of dataset.series) {
    if (
      !manifest.symbols.includes(series.symbol) ||
      found.has(series.symbol) ||
      series.timezone !== "UTC" ||
      !Array.isArray(series.candles) ||
      series.candles.length < 20 ||
      series.candles.length > 2500
    )
      throw new ApiError(
        "The historical series is incomplete or outside supported limits.",
        422,
      );
    found.add(series.symbol);
    let previous = "";
    for (const candle of series.candles) {
      const stamp = new Date(candle.timestamp);
      if (
        !Number.isFinite(stamp.getTime()) ||
        ![candle.open, candle.high, candle.low, candle.close].every(
          (value) => Number.isFinite(value) && value > 0,
        ) ||
        !Number.isInteger(candle.volume) ||
        candle.volume < 0 ||
        candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close)
      )
        throw new ApiError("The snapshot contains an invalid candle.", 422);
      const day = stamp.toISOString().slice(0, 10);
      if (day <= previous)
        throw new ApiError(
          "Backtesting requires chronological daily candles.",
          422,
        );
      previous = day;
    }
  }
  return { manifest, dataset, ownerId: account.user.id, revision, universeId };
}
function sameScope(left: BacktestScope, right: BacktestScope) {
  return (
    left.mode === right.mode &&
    left.from === right.from &&
    left.to === right.to &&
    left.n_steps === right.n_steps &&
    (left.rule_id ?? "") === (right.rule_id ?? "")
  );
}
export async function runBacktest(
  prepared: PreparedBacktest,
  config: BacktestConfig,
  ruleId: string,
  manualEntries: BacktestEntry[],
  signal: AbortSignal,
  progress: (stage: string) => void,
) {
  validateBacktestForm(config);
  check(signal, prepared.revision);
  if (!sameScope(prepared.manifest.backtest, backtestScope(config, ruleId)))
    throw new ApiError("Settings changed. Prepare a new snapshot.", 409);
  const account = await access(signal, prepared.revision);
  if (account.user.id !== prepared.ownerId)
    throw new ApiError("Account changed. Prepare a new snapshot.", 401);
  const current = await api.getBacktestManifest(
    prepared.manifest.dataset_id,
    signal,
  );
  check(signal, prepared.revision);
  if (
    current.purpose !== "backtest" ||
    current.version !== prepared.manifest.version ||
    current.checksum !== prepared.manifest.checksum ||
    !current.backtest ||
    !sameScope(current.backtest, prepared.manifest.backtest)
  )
    throw new ApiError("Snapshot changed. Prepare the data again.", 409);
  let entries = manualEntries;
  if (config.mode === "rule") {
    const rule = await api.getRule(ruleId, signal);
    check(signal, prepared.revision);
    if (rule.definition?.signal_type === "SELL")
      throw new ApiError("This backtest supports BUY entry rules only.", 422);
    progress("Calculating indicators…");
    const features = await extractBacktestFeatures(
      prepared.dataset.series,
      signal,
    );
    check(signal, prepared.revision);
    if (
      features.length !== prepared.dataset.series.length ||
      features.some(
        (group, i) =>
          group.engine_version !== "core-0.4.0" ||
          group.feature_schema_version !== "screener-features-1" ||
          group.candidates.length !==
            prepared.dataset.series[i].candles.length - 19 ||
          group.candidates.some(
            (candidate) =>
              candidate.symbol !== prepared.dataset.series[i].symbol,
          ),
      )
    )
      throw new ApiError(
        "The feature results do not match this snapshot.",
        409,
      );
    const grant = await api.createBacktestGrant(current, rule, signal);
    check(signal, prepared.revision);
    entries = [];
    for (const group of features) {
      progress(`Evaluating ${group.candidates[0]?.symbol}…`);
      const decision = await api.backtestSignals(
        grant.id,
        group.candidates,
        signal,
      );
      check(signal, prepared.revision);
      const allowed = new Set(
        group.candidates.map((item) => `${item.symbol}\0${item.timestamp}`),
      );
      if (
        decision.policy_version !== BACKTEST_POLICY ||
        !Array.isArray(decision.entries) ||
        decision.entries.some(
          (entry) =>
            entry.signal_type !== "BUY" ||
            !allowed.has(`${entry.symbol}\0${entry.timestamp}`),
        )
      )
        throw new ApiError(
          "The server returned invalid backtest entries.",
          409,
        );
      entries.push(...decision.entries);
      if (entries.length > 2000)
        throw new ApiError(
          "More than 2,000 entries were found. Choose a shorter range or fewer stocks.",
          422,
        );
    }
  } else if (!entries.length)
    throw new ApiError("Add at least one manual entry from the snapshot.", 422);
  progress("Simulating portfolio…");
  const result = await simulateBacktest(
    {
      schema_version: BACKTEST_SCHEMA,
      config,
      series: prepared.dataset.series,
      entries,
    },
    signal,
  );
  check(signal, prepared.revision);
  if (
    result.schema_version !== BACKTEST_SCHEMA ||
    result.policy_version !== BACKTEST_POLICY ||
    result.horizons.length !== config.n_steps
  )
    throw new ApiError("The backtest result version is incompatible.", 409);
  return result;
}
