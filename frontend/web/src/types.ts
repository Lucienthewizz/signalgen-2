export type User = {
  id: string;
  email: string;
  full_name?: string | null;
  role?: "user" | "admin";
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
  schema_version: "ohlcv-1";
  provider: "fixture";
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
  schema_version: "ohlcv-1";
  purpose: "screen";
  market: "IDX";
  currency: "IDR";
  symbol: string;
  timeframe: "1d";
  timezone: "UTC";
  adjustment: string;
  candles: Candle[];
};

export type RuleResource = {
  id: string;
  name: string;
  definition_hash: string;
  schema_version: string;
  engine_version: string;
  version: number;
  definition: Record<string, unknown>;
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
};

export type ScreenerFeatures = {
  rsi: number;
  ema_fast: number;
  ema_slow: number;
  volume_ratio: number;
  atr_ratio: number;
};

export type ScreenerResult = {
  type: "screener.result";
  request_id: string;
  symbol: string;
  score: number;
  decision: "candidate" | "observe";
  reason_codes: string[];
  evaluated_at: string;
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

export type DeviceListResponse = {
  items: AccountDevice[];
};
