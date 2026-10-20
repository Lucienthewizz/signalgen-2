/** Exchange-local candle date, not the time a result was requested or received. */
export function candleDate(
  value: string,
  timeframe = "1d",
  market = "IDX",
): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: marketTimezone(market),
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(timeframe !== "1d"
      ? {
          hour: "2-digit" as const,
          minute: "2-digit" as const,
          timeZoneName: "short" as const,
        }
      : {}),
  }).format(parsed);
}

export function marketTimezone(market: string): string {
  return market === "US" ? "America/New_York" : "Asia/Jakarta";
}

export function marketCandleDate(
  value: string,
  market: string,
  timeframe = "1d",
): string {
  return candleDate(value, timeframe, market);
}

export function candleRange(
  values: string[],
  market: string,
  timeframe = "1d",
): string {
  const times = values
    .map(Date.parse)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!times.length) return "unavailable";
  const from = marketCandleDate(
    new Date(times[0]).toISOString(),
    market,
    timeframe,
  );
  const to = marketCandleDate(
    new Date(times[times.length - 1]).toISOString(),
    market,
    timeframe,
  );
  return from === to ? from : `${from} – ${to}`;
}
