import type { ScreenerFeatureVector } from "@/types";
import type { ServerRecord } from "./server-records";

export type ScreeningJournalEntry = {
  schema_version: "screening-journal-1";
  source: "screening";
  symbol: string;
  market: "IDX" | "US";
  currency: "IDR" | "USD";
  rule_id: string;
  rule_name: string;
  definition_hash: string;
  timeframe: string;
  candle_at: string;
  screened_at: string;
  signal_type?: "BUY" | "SELL";
  matched: true;
  price: number;
  features: ScreenerFeatureVector;
  reason_codes: string[];
  dataset_checksum: string;
};

// The server is authoritative; this guard also keeps legacy trade records out
// of the new read-only screening list when an old client/cache is encountered.
export function isScreeningJournalRecord(
  item: ServerRecord<ScreeningJournalEntry>,
): boolean {
  const d = item?.data;
  return (
    !!d &&
    d.schema_version === "screening-journal-1" &&
    d.source === "screening" &&
    d.matched === true &&
    typeof d.symbol === "string" &&
    d.symbol.length > 0 &&
    typeof d.rule_name === "string" &&
    ((d.market === "IDX" && d.currency === "IDR") ||
      (d.market === "US" && d.currency === "USD")) &&
    ["1m", "5m", "15m", "1h", "1d"].includes(d.timeframe) &&
    (d.signal_type === undefined ||
      d.signal_type === "BUY" ||
      d.signal_type === "SELL") &&
    Number.isFinite(d.price) &&
    d.price > 0 &&
    Number.isFinite(Date.parse(d.candle_at)) &&
    Number.isFinite(Date.parse(d.screened_at))
  );
}
