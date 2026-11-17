/** Present provider notes without inferring missing per-stock quality metrics. */
export type StockDataNote = { label: string; value: string };
export type StockDataNotes = { symbol: string; fields: StockDataNote[] };

export function groupScreeningDataNotes(warnings: string[], symbols: string[]) {
  const general: string[] = [];
  const stocks = new Map<string, StockDataNotes>();
  const known = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  for (const warning of new Set(warnings)) {
    const separator = warning.indexOf(":");
    const symbol =
      separator > 0 ? warning.slice(0, separator).trim().toUpperCase() : "";
    if (!known.has(symbol)) {
      general.push(warning);
      continue;
    }
    const note = warning.slice(separator + 1).trim();
    let stock = stocks.get(symbol);
    if (!stock) {
      stock = { symbol, fields: [] };
      stocks.set(symbol, stock);
    }
    // This is the current intraday provider wording, not a source for daily/unknown metrics.
    const intraday =
      /^(\d+[mhdw]) regular-session closed candles; requested (\d+) calendar days; (\d+) null and (\d+) unfinished\/out-of-session rows excluded$/.exec(
        note,
      );
    if (intraday) {
      stock.fields.push(
        { label: "Candle interval", value: intraday[1] },
        { label: "Session", value: "Regular session · completed candles" },
        { label: "Requested period", value: `${intraday[2]} calendar days` },
        { label: "Null rows excluded", value: intraday[3] },
        {
          label: "Unfinished / out-of-session rows excluded",
          value: intraday[4],
        },
      );
    } else stock.fields.push({ label: "Provider note", value: note });
  }
  return { general, stocks: [...stocks.values()] };
}
