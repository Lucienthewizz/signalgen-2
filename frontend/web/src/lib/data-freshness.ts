/** Exchange-local candle date, not the time a result was requested or received. */
export function candleDate(
  value: string,
  timeframe = "1d",
  market = "IDX",
): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: market === "US" ? "America/New_York" : "Asia/Jakarta",
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
