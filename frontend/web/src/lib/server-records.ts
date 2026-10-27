export type ServerRecord<T> = {
  id: string;
  data: T;
  version: number;
  bytes: number;
};
export type TradeInput = {
  symbol: string;
  market: "IDX" | "US";
  currency: "IDR" | "USD";
  side: "BUY" | "SELL";
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  entry_fee: number;
  exit_fee: number;
  entry_date: string;
  exit_date: string;
  book: string;
  note: string;
};
export type RecordedTrade = TradeInput & {
  net_pl: number | null;
  return_pct: number | null;
};
export type AccountAudit = {
  id: string;
  actor: string;
  action: string;
  target_user_id: string;
  feature?: string;
  reason: string;
  request_id: string;
  created_at: string;
};
