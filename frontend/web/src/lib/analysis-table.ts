import type { BacktestTrade } from "@/analysis/backtest-types";

/** Presentation only: never changes portfolio metrics or the source report. */
export function backtestTradeRows(
  trades: BacktestTrade[],
  search: string,
  status: string,
  sort: string,
) {
  const query = search.trim().toLowerCase();
  return trades
    .filter(
      (trade) =>
        (status === "all" || trade.status === status) &&
        `${trade.symbol} ${trade.signal_time} ${trade.entry_time} ${trade.exit_time ?? ""}`
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) =>
      sort === "return"
        ? b.return_pct - a.return_pct
        : sort === "symbol"
          ? a.symbol.localeCompare(b.symbol)
          : sort === "newest"
            ? b.signal_time.localeCompare(a.signal_time)
            : 0,
    );
}
