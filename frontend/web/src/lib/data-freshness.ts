/** Exchange-local candle date, not the time a result was requested or received. */
export function candleDate(value: string, timeZone = "Asia/Jakarta"): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function marketTimezone(market: string): string {
  return market === "US" ? "America/New_York" : "Asia/Jakarta";
}

export function marketCandleDate(value: string, market: string): string {
  return candleDate(value, marketTimezone(market));
}

export function candleRange(values: string[], market: string): string {
  const times = values
    .map(Date.parse)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!times.length) return "unavailable";
  const from = marketCandleDate(new Date(times[0]).toISOString(), market);
  const to = marketCandleDate(
    new Date(times[times.length - 1]).toISOString(),
    market,
  );
  return from === to ? from : `${from} – ${to}`;
}
