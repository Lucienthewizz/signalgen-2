import type {
  BacktestConfig,
  BacktestDataset,
  BacktestEntry,
  BacktestHorizon,
  BacktestResult,
} from "./backtest-types";

function instantKey(timestamp: string): string | null {
  const match = timestamp?.match(
    /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return null;
  const day = match[1].slice(0, 10),
    dayInstant = Date.parse(day + "T00:00:00Z");
  if (
    !Number.isFinite(dayInstant) ||
    new Date(dayInstant).toISOString().slice(0, 10) !== day
  )
    return null;
  const seconds = Date.parse(match[1] + match[3]);
  return Number.isFinite(seconds)
    ? `${seconds}:${(match[2] ?? "").padEnd(9, "0")}`
    : null;
}

export function parseBacktestEntries(
  text: string,
  dataset: BacktestDataset,
  config: BacktestConfig,
  existing: BacktestEntry[],
): BacktestEntry[] {
  const entries: BacktestEntry[] = [];
  const errors: string[] = [];
  const seen = new Set(
    existing.map((e) => `${e.symbol}:${instantKey(e.timestamp)}`),
  );
  const lines = text.split(/\r?\n/);
  if (text.length > 500_000)
    throw Error("Manual input is too large. Maximum 2,000 entries.");
  let first = true;
  for (const [index, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    const parts = raw.split(",").map((s) => s.trim());
    if (
      first &&
      parts.length === 2 &&
      parts[0].toLowerCase() === "symbol" &&
      parts[1].toLowerCase() === "timestamp"
    ) {
      first = false;
      continue;
    }
    first = false;
    const [symbol, timestamp] = parts;
    const instant = Date.parse(timestamp);
    const key = instantKey(timestamp);
    const series = dataset.series.find((s) => s.symbol === symbol);
    const candleIndex =
      series?.candles.findIndex((c) => instantKey(c.timestamp) === key) ?? -1;
    let error = "";
    if (parts.length !== 2)
      error = "Use symbol,timestamp; BUY only, without a price override.";
    else if (!series) error = "Stock is outside the prepared universe.";
    else if (key === null || !Number.isFinite(instant) || candleIndex < 0)
      error = "Timestamp must match a completed snapshot candle (RFC3339).";
    else if (
      candleIndex < 19 ||
      new Date(instant).toISOString().slice(0, 10) < config.from ||
      new Date(instant).toISOString().slice(0, 10) > config.to
    )
      error = "Candle is outside the entry range or lacks warmup.";
    else if (seen.has(`${symbol}:${key}`))
      error = "Duplicate entry, including entries already added.";
    if (error) errors.push(`Line ${index + 1}: ${error}`);
    else {
      seen.add(`${symbol}:${key}`);
      entries.push({
        symbol,
        timestamp: series!.candles[candleIndex].timestamp,
        signal_type: "BUY",
      });
    }
  }
  if (existing.length + entries.length > 2000)
    errors.push("Maximum 2,000 entries, including entries already added.");
  if (errors.length)
    throw Error(
      errors.slice(0, 10).join("\n") +
        (errors.length > 10 ? `\nAnd ${errors.length - 10} more errors.` : ""),
    );
  if (!entries.length) throw Error("Add at least one symbol,timestamp row.");
  return entries;
}

function csv(rows: unknown[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = value == null ? "" : String(value);
            // Numeric losses remain numbers; untrusted text cannot become a spreadsheet formula.
            if (
              typeof value === "string" &&
              /^[\s\u0000-\u001f]*[=+@-]/.test(text)
            )
              text = "'" + text;
            return `"${text.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n")
  );
}

export function backtestTradesCSV(
  result: BacktestResult,
  horizon: BacktestHorizon,
  currency: string,
): string {
  return csv([
    [
      "schema",
      "policy",
      "currency",
      "horizon",
      "symbol",
      "signal_utc",
      "entry_utc",
      "exit_utc",
      "status",
      "quantity",
      "entry_price",
      "exit_price",
      "entry_commission",
      "exit_commission",
      "realized_pl",
      "unrealized_pl",
      "return_pct",
    ],
    ...horizon.trades.map((t) => [
      result.schema_version,
      result.policy_version,
      currency,
      horizon.label,
      t.symbol,
      t.signal_time,
      t.entry_time,
      t.exit_time,
      t.status,
      t.quantity,
      t.entry_price,
      t.exit_price,
      t.entry_commission,
      t.exit_commission,
      t.net_pl,
      t.unrealized_pl,
      t.return_pct,
    ]),
  ]);
}

export function backtestHorizonsCSV(
  result: BacktestResult,
  currency: string,
): string {
  const keys = [
    "initial_capital",
    "final_equity",
    "net_pl_cash",
    "unrealized_pl",
    "total_return_pct",
    "closed_trades",
    "open_trades",
    "wins",
    "losses",
    "flats",
    "win_rate",
    "profit_factor",
    "max_drawdown_pct",
    "total_commission",
    "expectancy_cash",
    "avg_win_cash",
    "avg_loss_cash",
    "risk_reward",
    "avg_return_pct",
  ] as const;
  return csv([
    ["schema", "policy", "currency", "horizon", "skipped_entries", ...keys],
    ...result.horizons.map((h) => [
      result.schema_version,
      result.policy_version,
      currency,
      h.label,
      h.skipped.length,
      ...keys.map((k) => h.metrics[k]),
    ]),
  ]);
}

export function downloadBacktestCSV(filename: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
