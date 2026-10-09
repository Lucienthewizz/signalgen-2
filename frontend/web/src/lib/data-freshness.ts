/** Exchange-local candle date, not the time a result was requested or received. */
export function candleDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "belum tersedia";
  return new Intl.DateTimeFormat("id-ID", {timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric"}).format(parsed);
}
