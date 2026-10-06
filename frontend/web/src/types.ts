export type User = {
  id: string;
  email: string;
  full_name?: string | null;
  role?: "user" | "admin" | "operator";
  status?: "active" | "suspended";
  entitlement?: {
    plan_code: string;
    status: string;
    valid_until?: string | null;
  } | null;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
};

export type RegisterResponse = {
  message: string;
  requires_email_confirmation: boolean;
  access_token?: string | null;
  user: User;
};

export type ApiStatus = {
  name: string;
  version: string;
  description: string;
  docs: string;
  status: string;
};

export type MessageResponse = {
  message: string;
};

export type AppSessionResponse = {
  session: {
    id: string;
    installation_id: string;
    label: string;
    created_at: string;
    expires_at: string;
    last_seen_at: string;
  };
  session_token: string;
};

export type DatasetManifest = {
  dataset_id: string;
  version: string;
  schema_version: "ohlcv-multi-1";
  provider: "yahoo_finance";
  purpose: "screen";
  market: "IDX";
  currency: "IDR";
  symbols: string[];
  timeframe: "1d";
  timezone: "UTC";
  requested_range: { from: string; to: string };
  available_range: { from: string; to: string };
  warmup_candles: number;
  adjustment: string;
  candle_count: number;
  decoded_bytes: number;
  checksum: string;
  quality: { status: "complete"; warnings: string[] };
};

export type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type DatasetContent = {
  schema_version: "ohlcv-multi-1";
  purpose: "screen";
  market: "IDX";
  currency: "IDR";
  timeframe: "1d";
  timezone: "UTC";
  adjustment: string;
  series: Array<{
    symbol: string;
    timezone: "UTC";
    candles: Candle[];
  }>;
};

export type RuleCondition = {
  left: "PRICE" | "EMA9" | "EMA20" | "RSI14";
  op: "<" | "<=" | ">" | ">=";
  right: string | number;
};

export type UserRuleDefinition = {
  name: string;
  logic: "AND";
  signal_type: "BUY";
  cooldown_sec: number;
  conditions: RuleCondition[];
};

export type RuleResource = {
  id: string;
  name: string;
  owner_type: "system" | "user";
  read_only: boolean;
  definition_hash: string;
  schema_version: string;
  engine_version: string;
  version: number;
  definition?: UserRuleDefinition;
  created_at?: string;
  updated_at?: string;
};

export type RuleListResponse = {
  items: RuleResource[];
  next_cursor: string | null;
};

export type StockInstrument = {
  symbol: "BBCA.JK" | "BBRI.JK" | "TLKM.JK";
  name: string;
  exchange: "XIDX";
  currency: "IDR";
};

export type StockUniverse = {
  id: string;
  name: string;
  symbols: StockInstrument["symbol"][];
  version: number;
  created_at: string;
  updated_at: string;
};

export type SubscriptionPlan = {
  code: "free" | "analyst" | "pro";
  name: string;
  description: string;
  features: Array<"screener" | "backtest">;
};

export type Subscription = {
  id: string;
  user_id?: string;
  plan_code: SubscriptionPlan["code"];
  plan_name: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  features: Array<"screener" | "backtest">;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  source: "manual" | "payment_provider";
  created_at: string;
  updated_at: string;
};

export type FeatureGrant = {
  user_id: string;
  feature: "screener" | "backtest";
  valid_until: string;
  reason: string;
  revoked_at: string | null;
  updated_at: string;
  active: boolean;
};

export type AccountRole = {
  user_id: string;
  role: "user" | "operator";
  status: "active" | "suspended";
  updated_at: string;
};

export type ComputeGrant = {
  id: string;
  purpose: "screen";
  dataset_id: string;
  dataset_version: string;
  dataset_checksum: string;
  rule_id: string;
  definition_hash: string;
  engine_version: string;
  schema_version: string;
  created_at: string;
  expires_at: string;
};

export type ScreenerSocketTicket = {
  ticket: string;
  expires_at: string;
  websocket_path: string;
  protocol: "screener-private-1";
  feature_schema_version: "screener-features-1";
  max_candidates: number;
};

export type ScreenerFeatureVector = {
  price: number;
  ema9: number;
  ema20: number;
  rsi14: number;
};

export type ScreenerFeatureCandidate = {
  symbol: string;
  timestamp: string;
  features: ScreenerFeatureVector;
};

export type ScreenerFeatureResult = {
  engine_version: "core-0.3.0";
  feature_schema_version: "screener-features-1";
  execution: "client_go_features";
  candidates: ScreenerFeatureCandidate[];
  candle_count: number;
  warnings: string[];
};

export type ScreenerDecision = {
  symbol: string;
  timestamp: string;
  matched: boolean;
  reason_codes: string[];
};

export type ScreenerResult = {
  type: "screener.result";
  protocol: "screener-private-1";
  request_id: string;
  decision_version: string;
  results: ScreenerDecision[];
};

export type AccountState = {
  user: {
    id: string;
    email: string;
    role: "user" | "operator";
    status: "active" | "suspended";
  };
  features: Array<"screener" | "backtest">;
  session: {
    id: string;
    expires_at: string;
  };
  device: {
    installation_id: string;
    label: string;
    current: true;
  };
  capabilities_version: string;
};

export type AccountDevice = {
  id: string;
  label: string;
  status: "active" | "expired" | "revoked";
  created_at: string;
  last_seen_at: string;
  current: boolean;
};

export type AccountSession = {
  id: string;
  installation_id: string;
  label: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  status: "active" | "expired" | "revoked";
  current: boolean;
};

export type DeviceListResponse = {
  items: AccountDevice[];
};

export type SessionListResponse = {
  items: AccountSession[];
};
