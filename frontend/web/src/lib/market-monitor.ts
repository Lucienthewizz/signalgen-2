import type { LiveScreenerRun } from "@/analysis/screener";
import type { RuleResource, UserRuleDefinition } from "@/types";
import {
  readWorkspaceData,
  hasWorkspaceData,
  writeWorkspaceData,
  WORKSPACE_MAX_AGE,
  validatedRuleDraft,
} from "@/lib/workspace-storage";

export type MonitorRun = {
  rule: string;
  recordedAt: string;
  run: LiveScreenerRun;
  context?: {
    ruleId: string;
    universeId: string;
    universeName: string;
    ruleSnapshot?: RuleSnapshot;
  };
};
export type RuleSnapshot = {
  version: number;
  definition_hash: string;
  definition?: UserRuleDefinition;
};
export function frozenRule(rule: RuleResource): RuleSnapshot {
  return {
    version: rule.version,
    definition_hash: rule.definition_hash,
    ...(rule.owner_type === "user" && rule.definition
      ? { definition: rule.definition }
      : {}),
  };
}
function safeRuleSnapshot(value: unknown): RuleSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as RuleSnapshot;
  if (
    !Number.isInteger(v.version) ||
    v.version < 1 ||
    typeof v.definition_hash !== "string" ||
    v.definition_hash.length > 200
  )
    return undefined;
  const draft = validatedRuleDraft({
    definition: v.definition,
    editingId: null,
    editingVersion: null,
  });
  return {
    version: v.version,
    definition_hash: v.definition_hash,
    ...(draft ? { definition: draft.definition } : {}),
  };
}

export function compareMonitorRuns(before: MonitorRun, after: MonitorRun) {
  const old = new Map(
    before.run.rows.map((row) => [
      monitorTicker(row.decision.symbol, before.run.manifest.market),
      row.decision.matched,
    ]),
  );
  const next = new Map(
    after.run.rows.map((row) => [
      monitorTicker(row.decision.symbol, after.run.manifest.market),
      row.decision.matched,
    ]),
  );
  const gained: string[] = [],
    lost: string[] = [],
    retained: string[] = [],
    unpaired: string[] = [];
  for (const [symbol, matched] of next) {
    if (!symbol) continue;
    if (!old.has(symbol)) {
      unpaired.push(symbol);
      continue;
    }
    if (matched && !old.get(symbol)) gained.push(symbol);
    else if (!matched && old.get(symbol)) lost.push(symbol);
    else if (matched) retained.push(symbol);
  }
  for (const symbol of old.keys())
    if (symbol && !next.has(symbol)) unpaired.push(symbol);
  const sameRule = Boolean(
    before.context?.ruleSnapshot &&
    after.context?.ruleSnapshot &&
    before.context.ruleId === after.context.ruleId &&
    before.context.ruleSnapshot.definition_hash ===
      after.context.ruleSnapshot.definition_hash,
  );
  return {
    gained,
    lost,
    retained,
    unpaired,
    common: [...next.keys()].filter((key) => old.has(key)).length,
    sameRule,
  };
}
const history = new Map<string, MonitorRun[]>();

const fields = new Set([
  "result",
  "latestDecision",
  "features",
  "manifest",
  "latestClose",
  "latestOpen",
  "rows",
  "execution",
  "type",
  "protocol",
  "request_id",
  "decision_version",
  "results",
  "symbol",
  "timestamp",
  "matched",
  "reason_codes",
  "price",
  "ema9",
  "ema20",
  "rsi14",
  "dataset_id",
  "version",
  "schema_version",
  "provider",
  "purpose",
  "market",
  "currency",
  "symbols",
  "exchanges",
  "timeframe",
  "timezone",
  "requested_range",
  "available_range",
  "from",
  "to",
  "warmup_candles",
  "adjustment",
  "candle_count",
  "decoded_bytes",
  "checksum",
  "quality",
  "status",
  "warnings",
  "decision",
]);
function cleanSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, 200);
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => cleanSnapshot(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => fields.has(key))
        .map(([key, item]) => [key, cleanSnapshot(item, depth + 1)]),
    );
  return null;
}
function validRun(value: unknown): value is LiveScreenerRun {
  if (!value || typeof value !== "object") return false;
  const run = value as LiveScreenerRun;
  const decision = (d: LiveScreenerRun["latestDecision"]) =>
    d &&
    typeof d.symbol === "string" &&
    monitorTicker(d.symbol, run.manifest?.market) !== null &&
    typeof d.timestamp === "string" &&
    Number.isFinite(Date.parse(d.timestamp)) &&
    typeof d.matched === "boolean" &&
    Array.isArray(d.reason_codes) &&
    d.reason_codes.every((code) => typeof code === "string");
  const features = (f: LiveScreenerRun["features"]) =>
    f &&
    [f.price, f.ema9, f.ema20, f.rsi14].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    );
  const manifest = run.manifest;
  const range = (r: LiveScreenerRun["manifest"]["available_range"]) =>
    r &&
    typeof r.from === "string" &&
    typeof r.to === "string" &&
    Number.isFinite(Date.parse(r.from)) &&
    Number.isFinite(Date.parse(r.to));
  const validManifest =
    manifest &&
    manifest.schema_version === "ohlcv-multi-1" &&
    manifest.provider === "yahoo_finance" &&
    manifest.purpose === "screen" &&
    ((manifest.market === "IDX" && manifest.currency === "IDR") ||
      (manifest.market === "US" && manifest.currency === "USD")) &&
    (manifest.exchanges === undefined ||
      (Array.isArray(manifest.exchanges) &&
        manifest.exchanges.length === manifest.symbols?.length &&
        manifest.exchanges.every((exchange) =>
          manifest.market === "IDX"
            ? exchange === "XIDX"
            : exchange === "XNAS" || exchange === "XNYS",
        ))) &&
    manifest.timeframe === "1d" &&
    manifest.timezone === "UTC" &&
    [
      manifest.dataset_id,
      manifest.version,
      manifest.adjustment,
      manifest.checksum,
    ].every((v) => typeof v === "string" && v.length > 0) &&
    [
      manifest.warmup_candles,
      manifest.candle_count,
      manifest.decoded_bytes,
    ].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0) &&
    range(manifest.available_range) &&
    range(manifest.requested_range) &&
    manifest.quality &&
    manifest.quality.status === "complete" &&
    Array.isArray(manifest.quality.warnings) &&
    manifest.quality.warnings.every((v) => typeof v === "string");
  return (
    run.execution === "client_wasm+server_private_scoring" &&
    validManifest &&
    Array.isArray(run.manifest.symbols) &&
    run.manifest.symbols.length > 0 &&
    run.manifest.symbols.every(
      (symbol) =>
        typeof symbol === "string" &&
        monitorTicker(symbol, manifest.market) !== null,
    ) &&
    decision(run.latestDecision) &&
    features(run.features) &&
    typeof run.latestClose === "number" &&
    Number.isFinite(run.latestClose) &&
    (run.latestOpen === null ||
      (typeof run.latestOpen === "number" &&
        Number.isFinite(run.latestOpen))) &&
    !!run.result &&
    run.result.type === "screener.result" &&
    run.result.protocol === "screener-private-1" &&
    typeof run.result.request_id === "string" &&
    typeof run.result.decision_version === "string" &&
    Array.isArray(run.result.results) &&
    run.result.results.every(decision) &&
    Array.isArray(run.rows) &&
    run.rows.length > 0 &&
    run.rows.length <= 100 &&
    run.rows.every(
      (row) =>
        row &&
        decision(row.decision) &&
        features(row.features) &&
        typeof row.latestClose === "number" &&
        Number.isFinite(row.latestClose) &&
        (row.latestOpen === null ||
          (typeof row.latestOpen === "number" &&
            Number.isFinite(row.latestOpen))),
    )
  );
}
function storedRuns(value: unknown): MonitorRun[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item) => {
    if (
      !item ||
      typeof item.rule !== "string" ||
      item.rule.length > 100 ||
      typeof item.recordedAt !== "string"
    )
      return [];
    const time = Date.parse(item.recordedAt);
    if (
      !Number.isFinite(time) ||
      time > Date.now() + 60_000 ||
      Date.now() - time > WORKSPACE_MAX_AGE
    )
      return [];
    const run = cleanSnapshot(item.run);
    if (!validRun(run)) return [];
    const c = item.context;
    const context =
      c &&
      [c.ruleId, c.universeId, c.universeName].every(
        (v) => typeof v === "string" && v.length <= 200,
      )
        ? {
            ruleId: c.ruleId,
            universeId: c.universeId,
            universeName: c.universeName,
            ...(safeRuleSnapshot(c.ruleSnapshot)
              ? { ruleSnapshot: safeRuleSnapshot(c.ruleSnapshot) }
              : {}),
          }
        : undefined;
    return [
      {
        rule: item.rule,
        recordedAt: item.recordedAt,
        run,
        ...(context ? { context } : {}),
      },
    ];
  });
}
export function recordMonitorRun(
  userId: string,
  rule: string,
  run: LiveScreenerRun,
  context?: MonitorRun["context"],
) {
  if (!userId) return;
  const snapshot = storedRuns([
    {
      rule: rule.slice(0, 100),
      recordedAt: new Date().toISOString(),
      run,
      context,
    },
  ])[0];
  if (!snapshot) return;
  history.set(userId, [snapshot, ...monitorRuns(userId)].slice(0, 10));
  const durable = [...(history.get(userId) ?? [])];
  while (
    durable.length &&
    !writeWorkspaceData(userId, "monitor-history", durable)
  )
    durable.pop();
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("signalgen:monitor-run"));
}
export function monitorRuns(userId?: string) {
  if (!userId) return [];
  const stored = readWorkspaceData(userId, "monitor-history");
  if (stored === null && hasWorkspaceData(userId, "monitor-history"))
    history.delete(userId);
  if (stored !== null) {
    const combined = storedRuns(stored);
    const seen = new Set<string>();
    history.set(
      userId,
      combined
        .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
        .filter((item) => {
          const key = `${item.recordedAt}:${item.rule}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 10),
    );
  }
  const current = (history.get(userId) ?? []).filter(
    (item) => Date.now() - Date.parse(item.recordedAt) <= WORKSPACE_MAX_AGE,
  );
  history.set(userId, current);
  return current;
}
export function idxTicker(value: string) {
  const ticker = value
    .trim()
    .toUpperCase()
    .replace(/^IDX:/, "")
    .replace(/\.JK$/, "");
  return /^[A-Z]{4}$/.test(ticker) ? ticker : null;
}

// Namespaced US watchlist keys prevent an American AAPL from becoming IDX:AAPL.
// Existing unprefixed four-letter IDX watchlists remain compatible.
export function usTicker(value: string) {
  const ticker = value
    .trim()
    .toUpperCase()
    .replace(/^(US|NASDAQ|NYSE):/, "")
    .replace(/\.([A-Z])$/, "-$1");
  return /^[A-Z][A-Z0-9]{0,9}(-[A-Z])?$/.test(ticker) ? ticker : null;
}
export function monitorTicker(value: string, market: "IDX" | "US" = "IDX") {
  if (market === "US") {
    const ticker = usTicker(value);
    return ticker ? `US:${ticker}` : null;
  }
  return idxTicker(value);
}
export function watchTicker(value: string) {
  return /^(US|NASDAQ|NYSE):/i.test(value.trim())
    ? monitorTicker(value, "US")
    : idxTicker(value);
}

export function priceMovement(open?: number | null, close?: number | null) {
  if (
    open == null ||
    close == null ||
    !Number.isFinite(open) ||
    !Number.isFinite(close)
  )
    return "unknown";
  return close > open ? "up" : close < open ? "down" : "flat";
}

export function openCloseChange(
  open?: number | null,
  close?: number | null,
): number | null {
  if (
    open == null ||
    close == null ||
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    open <= 0 ||
    close < 0
  )
    return null;
  return ((close - open) / open) * 100;
}
export function snapshotAge(timestamp?: string, now = Date.now()) {
  const stamp = timestamp ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(stamp) || !Number.isFinite(now)) return "unknown";
  if (stamp > now + 300_000) return "future";
  return now - stamp > 7 * 86400000 ? "old" : "recent";
}
