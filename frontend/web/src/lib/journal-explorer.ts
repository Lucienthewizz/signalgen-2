import type { ScreeningJournalEntry } from "./screening-journal";
import type { ServerRecord } from "./server-records";
export type JournalItem = ServerRecord<ScreeningJournalEntry>;
export type JournalFilters = {
  search: string;
  rule: string;
  signal: string;
  market: string;
  from: string;
  to: string;
  sort: string;
};
export const emptyJournalFilters: JournalFilters = {
  search: "",
  rule: "",
  signal: "",
  market: "",
  from: "",
  to: "",
  sort: "newest",
};
// Use the application's SGT date, never the browser's local date.
export function screeningDay(value: string) {
  const n = Date.parse(value);
  return Number.isFinite(n)
    ? new Date(n + 8 * 3600000).toISOString().slice(0, 10)
    : "";
}
export function filterJournal(items: JournalItem[], filters: JournalFilters) {
  const query = filters.search.trim().toLowerCase();
  return items
    .filter(({ data: d }) => {
      const day = screeningDay(d.screened_at);
      return (
        (!query ||
          `${d.symbol} ${d.rule_name}`.toLowerCase().includes(query)) &&
        (!filters.rule || d.rule_id === filters.rule) &&
        (!filters.signal || (d.signal_type ?? "MATCH") === filters.signal) &&
        (!filters.market || d.market === filters.market) &&
        (!filters.from || day >= filters.from) &&
        (!filters.to || day <= filters.to)
      );
    })
    .sort((a, b) => {
      if (filters.sort === "symbol")
        return (
          a.data.symbol.localeCompare(b.data.symbol) || a.id.localeCompare(b.id)
        );
      const difference =
        Date.parse(a.data.screened_at) - Date.parse(b.data.screened_at);
      return (
        (filters.sort === "oldest" ? difference : -difference) ||
        a.id.localeCompare(b.id)
      );
    });
}
export function journalSummary(items: JournalItem[]) {
  const stocks = new Map<string, number>(),
    rules = new Map<string, { name: string; count: number }>();
  let buy = 0,
    sell = 0;
  for (const { data: d } of items) {
    if (d.signal_type === "BUY") buy++;
    else if (d.signal_type === "SELL") sell++;
    stocks.set(d.symbol, (stocks.get(d.symbol) ?? 0) + 1);
    rules.set(d.rule_id, {
      name: d.rule_name,
      count: (rules.get(d.rule_id)?.count ?? 0) + 1,
    });
  }
  const topStock = [...stocks].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  const topRule = [...rules].sort(
    (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
  )[0];
  return {
    total: items.length,
    buy,
    sell,
    other: items.length - buy - sell,
    stocks: stocks.size,
    rules: rules.size,
    topStock,
    topRule,
  };
}

export function journalActivity(items: JournalItem[]) {
  const days = new Map<
    string,
    { day: string; buy: number; sell: number; other: number; total: number }
  >();
  for (const { data } of items) {
    const day = screeningDay(data.screened_at);
    if (!day) continue;
    const counts = days.get(day) ?? {
      day,
      buy: 0,
      sell: 0,
      other: 0,
      total: 0,
    };
    if (data.signal_type === "BUY") counts.buy++;
    else if (data.signal_type === "SELL") counts.sell++;
    else counts.other++;
    counts.total++;
    days.set(day, counts);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
export function journalCsvRows(items: JournalItem[]): unknown[][] {
  return [
    [
      "Source",
      "Stock",
      "Market",
      "Currency",
      "Rule",
      "Signal",
      "Interval",
      "Candle time (UTC)",
      "Screened at (UTC)",
      "Screened date (SGT)",
      "Screening price",
      "RSI14",
      "EMA9",
      "EMA20",
      "Reasons",
      "Dataset checksum",
    ],
    ...items.map(({ data: d }) => [
      "Screening snapshot",
      d.symbol,
      d.market,
      d.currency,
      d.rule_name,
      d.signal_type ?? "Match",
      d.timeframe,
      d.candle_at,
      d.screened_at,
      screeningDay(d.screened_at),
      d.price,
      d.features?.rsi14,
      d.features?.ema9,
      d.features?.ema20,
      (d.reason_codes ?? []).join("; "),
      d.dataset_checksum,
    ]),
  ];
}
