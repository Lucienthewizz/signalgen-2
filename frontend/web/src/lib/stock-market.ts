import type {
  DatasetManifest,
  StockCurrency,
  StockInstrument,
  StockMarket,
} from "../types";

export const marketLabels: Record<StockMarket, string> = {
  IDX: "Indonesia · IDX · IDR",
  US: "Amerika Serikat · Nasdaq/NYSE · USD",
};
export function stockMarket(stock: StockInstrument): StockMarket {
  return stock.exchange === "XIDX" ? "IDX" : "US";
}
export function symbolMarket(symbol: string): StockMarket {
  return symbol.endsWith(".JK") ? "IDX" : "US";
}
export function formatStockPrice(value: number, currency: StockCurrency) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Exchange comes from catalog-derived snapshot metadata, never a guessed IDX prefix. */
export function snapshotChartSymbol(
  symbol: string,
  manifest: Pick<DatasetManifest, "market" | "symbols" | "exchanges">,
): string {
  if (manifest.market === "IDX") return `IDX:${symbol.replace(/\.JK$/, "")}`;
  const exchange = manifest.exchanges?.[manifest.symbols.indexOf(symbol)];
  const prefix =
    exchange === "XNAS" ? "NASDAQ:" : exchange === "XNYS" ? "NYSE:" : "";
  return prefix + symbol.replace(/-([A-Z])$/, ".$1");
}
