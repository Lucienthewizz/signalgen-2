import type {
  ApiStatus,
  LoginResponse,
  RegisterResponse,
  MessageResponse,
  User,
  AppSessionResponse,
  AccountState,
  DeviceListResponse,
  ComputeGrant,
  DatasetContent,
  DatasetManifest,
  RuleListResponse,
  RuleResource,
  UserRuleDefinition,
  ScreenerSocketTicket,
  StockInstrument,
  StockUniverse,
  SubscriptionPlan,
  Subscription,
  FeatureGrant,
  AccountRole,
  SessionListResponse,
} from "../types";

const TOKEN_KEY = "signalgen.access-token";
const APP_SESSION_KEY = "signalgen.app-session";
const APP_SESSION_ORIGIN_KEY = "signalgen.app-session-origin";
const INSTALLATION_KEY = "signalgen.installation-id";
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export const session = {
  getToken: () => sessionStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  getAppSession: () => sessionStorage.getItem(APP_SESSION_KEY),
  setAppSession: (token: string) => {
    sessionStorage.setItem(APP_SESSION_KEY, token);
    sessionStorage.setItem(APP_SESSION_ORIGIN_KEY, API_ORIGIN || "same-origin");
  },
  clearAppSession: () => {
    sessionStorage.removeItem(APP_SESSION_KEY);
    sessionStorage.removeItem(APP_SESSION_ORIGIN_KEY);
  },
  getInstallationId: () => {
    const existing = localStorage.getItem(INSTALLATION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, created);
    return created;
  },
  clear: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    session.clearAppSession();
  },
};

type ErrorEnvelope = {
  code?: string;
  message?: string;
  request_id?: string;
};

function errorEnvelope(payload: unknown): ErrorEnvelope | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload))
    return undefined;
  const error = (payload as { error?: unknown }).error;
  return error && typeof error === "object"
    ? (error as ErrorEnvelope)
    : undefined;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retryExpiredSession = true,
): Promise<T> {
  const token = session.getToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const appSession = session.getAppSession();
  if (appSession) headers.set("X-App-Session", appSession);

  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      "The service is currently unavailable. Try again in a moment.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const envelope = errorEnvelope(payload);
    const expiredAppSession =
      response.status === 403 &&
      (envelope?.code === "SESSION_EXPIRED" ||
        envelope?.code === "SESSION_REVOKED");
    if (
      retryExpiredSession &&
      expiredAppSession &&
      path !== "/api/v1/sessions"
    ) {
      session.clearAppSession();
      await api.ensureAppSession();
      return request<T>(path, init, false);
    }
    if (response.status === 401 && path !== "/api/auth/login") {
      session.clear();
      window.dispatchEvent(new Event("signalgen:unauthorized"));
    }
    throw new ApiError(
      errorDetail(payload, response.status),
      response.status,
      envelope?.code,
      envelope?.request_id,
    );
  }
  return payload as T;
}

function errorDetail(payload: unknown, status: number): string {
  const detail =
    payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail
      : undefined;
  const apiError = errorEnvelope(payload);
  if (apiError?.code === "DEVICE_SWITCH_COOLDOWN")
    return "Perangkat hanya dapat dipindahkan satu kali per hari.";
  if (apiError?.code === "DEVICE_MISMATCH")
    return "Jaringan perangkat berubah. Masuk kembali dari jaringan yang terdaftar.";
  if (apiError?.code === "ENTITLEMENT_REQUIRED")
    return "Akun ini belum memiliki akses fitur screener.";
  if (apiError?.code === "SESSION_EXPIRED")
    return "Your workspace session expired. Run the screen again to reconnect.";
  if (apiError?.code === "SESSION_REVOKED")
    return "This workspace session was revoked. Run the screen again to reconnect.";
  if (apiError?.code === "ROLE_REQUIRED")
    return "Your account role does not allow this screening action.";
  if (apiError?.code === "RATE_LIMITED")
    return "Too many requests were sent. Wait a moment, then try again.";
  if (apiError?.code === "SERVICE_UNAVAILABLE")
    return "The screening service is temporarily unavailable. Try again shortly.";
  if (apiError?.message) return apiError.message;
  if (Array.isArray(detail)) {
    return "Check your email, name, and password length, then try again.";
  }
  if (detail === "Invalid email or password")
    return "The email or password is incorrect. Check your details and try again.";
  if (typeof detail === "string" && detail.startsWith("Registration failed"))
    return "Registration failed. Check your details and try again.";
  if (typeof detail === "string") return detail;
  if (status >= 500)
    return "The service is having trouble. Try again in a moment.";
  return "The request could not be completed. Try again.";
}

export const api = {
  status: () => request<ApiStatus>("/api"),
  login: (email: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (fullName: string, email: string, password: string) =>
    request<RegisterResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ full_name: fullName, email, password }),
    }),
  requestPasswordReset: (email: string) =>
    request<MessageResponse>("/api/auth/password/reset-request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (
    accessToken: string,
    refreshToken: string,
    password: string,
  ) =>
    request<MessageResponse>("/api/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        password,
      }),
    }),
  me: () => request<User>("/api/auth/me"),
  createAppSession: () =>
    request<AppSessionResponse>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        installation_id: session.getInstallationId(),
        label: browserLabel(),
        client: {
          app_version: "web-0.1",
          user_agent_family: navigator.userAgent,
        },
      }),
    }),
  ensureAppSession: async () => {
    const existing = session.getAppSession();
    const storedOrigin = sessionStorage.getItem(APP_SESSION_ORIGIN_KEY);
    if (existing && storedOrigin === (API_ORIGIN || "same-origin"))
      return existing;
    session.clearAppSession();
    const created = await api.createAppSession();
    session.setAppSession(created.session_token);
    return created.session_token;
  },
  revokeCurrentAppSession: () =>
    request<void>("/api/v1/sessions/current", { method: "DELETE" }),
  account: () => request<AccountState>("/api/v1/account/me"),
  listSessions: () => request<SessionListResponse>("/api/v1/account/sessions"),
  revokeSession: (id: string) =>
    request<void>(`/api/v1/account/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listDevices: () => request<DeviceListResponse>("/api/v1/account/devices"),
  renameDevice: (installationId: string, label: string) =>
    request<void>(
      `/api/v1/account/devices/${encodeURIComponent(installationId)}`,
      { method: "PATCH", body: JSON.stringify({ label }) },
    ),
  revokeDevice: (installationId: string) =>
    request<void>(
      `/api/v1/account/devices/${encodeURIComponent(installationId)}`,
      { method: "PATCH", body: JSON.stringify({ status: "revoked" }) },
    ),
  getRule: (id: string) =>
    request<RuleResource>(`/api/v1/rules/${encodeURIComponent(id)}`),
  listRules: () => request<RuleListResponse>("/api/v1/rules"),
  createRule: (definition: UserRuleDefinition) =>
    request<RuleResource>("/api/v1/rules", {
      method: "POST",
      body: JSON.stringify({ definition }),
    }),
  updateRule: (id: string, version: number, definition: UserRuleDefinition) =>
    request<RuleResource>(`/api/v1/rules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ version, definition }),
    }),
  deleteRule: (id: string, version: number) =>
    request<void>(`/api/v1/rules/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ version }),
    }),
  listStocks: () => request<{ items: StockInstrument[] }>("/api/v1/stocks"),
  listStockUniverses: () =>
    request<{ items: StockUniverse[] }>("/api/v1/stock-universes"),
  createStockUniverse: (name: string, symbols: StockInstrument["symbol"][]) =>
    request<StockUniverse>("/api/v1/stock-universes", {
      method: "POST",
      body: JSON.stringify({ name, symbols }),
    }),
  updateStockUniverse: (
    id: string,
    version: number,
    name: string,
    symbols: StockInstrument["symbol"][],
  ) =>
    request<StockUniverse>(
      `/api/v1/stock-universes/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ version, name, symbols }),
      },
    ),
  deleteStockUniverse: (id: string, version: number) =>
    request<void>(`/api/v1/stock-universes/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ version }),
    }),
  prepareDataset: (ruleId: string, universeId: string) =>
    request<DatasetManifest>("/api/v1/datasets/prepare", {
      method: "POST",
      body: JSON.stringify({
        purpose: "screen",
        rule_id: ruleId,
        universe_id: universeId,
      }),
    }),
  getDatasetContent: (datasetId: string) =>
    request<DatasetContent>(
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/content`,
    ),
  createComputeGrant: (manifest: DatasetManifest, rule: RuleResource) =>
    request<ComputeGrant>("/api/v1/compute-grants", {
      method: "POST",
      body: JSON.stringify({
        purpose: "screen",
        dataset_id: manifest.dataset_id,
        dataset_version: manifest.version,
        dataset_checksum: manifest.checksum,
        rule_id: rule.id,
        definition_hash: rule.definition_hash,
        engine_version: rule.engine_version,
        schema_version: rule.schema_version,
      }),
    }),
  createScreenerSocketTicket: (computeGrantId: string) =>
    request<ScreenerSocketTicket>("/api/v1/screener/socket-tickets", {
      method: "POST",
      body: JSON.stringify({
        compute_grant_id: computeGrantId,
        protocol: "screener-private-1",
      }),
    }),
  listSubscriptionPlans: () =>
    request<{ items: SubscriptionPlan[] }>("/api/v1/subscription/plans"),
  currentSubscription: () =>
    request<{ subscription: Subscription | null }>("/api/v1/subscription"),
  cancelSubscription: (atPeriodEnd: boolean, reason: string) =>
    request<{ subscription: Subscription }>("/api/v1/subscription/cancel", {
      method: "POST",
      body: JSON.stringify({ at_period_end: atPeriodEnd, reason }),
    }),
  listFeatureGrants: (userId: string) =>
    request<{ items: FeatureGrant[] }>(
      `/api/v1/operator/grants?user_id=${encodeURIComponent(userId)}`,
    ),
  grantFeature: (
    userId: string,
    feature: FeatureGrant["feature"],
    validUntil: string,
    reason: string,
  ) =>
    request<FeatureGrant>("/api/v1/operator/grants", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        feature,
        valid_until: validUntil,
        reason,
      }),
    }),
  revokeFeature: (
    userId: string,
    feature: FeatureGrant["feature"],
    reason: string,
  ) =>
    request<void>(
      `/api/v1/operator/grants/${encodeURIComponent(userId)}/${encodeURIComponent(feature)}`,
      { method: "DELETE", body: JSON.stringify({ reason }) },
    ),
  changeAccountRole: (
    userId: string,
    role: AccountRole["role"],
    reason: string,
  ) =>
    request<AccountRole>(
      `/api/v1/operator/accounts/${encodeURIComponent(userId)}/role`,
      {
        method: "PATCH",
        body: JSON.stringify({ role, reason }),
      },
    ),
  activateSubscription: (
    userId: string,
    planCode: SubscriptionPlan["code"],
    currentPeriodEnd: string,
    reason: string,
  ) =>
    request<{ subscription: Subscription }>("/api/v1/operator/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        plan_code: planCode,
        current_period_end: currentPeriodEnd,
        reason,
      }),
    }),
};

export function websocketURL(path: string, ticket: string): string {
  const base = API_ORIGIN || window.location.origin;
  const url = new URL(path, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

function browserLabel(): string {
  const platform = navigator.platform || "Browser";
  return `Signalgen Web · ${platform}`.slice(0, 100);
}
