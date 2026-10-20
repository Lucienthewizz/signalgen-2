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
  EditableProfile,
} from "../types";

const TOKEN_KEY = "signalgen.access-token";
const REFRESH_KEY = "signalgen.refresh-token";
const EXPIRY_KEY = "signalgen.token-expires-at";
const APP_SESSION_KEY = "signalgen.app-session";
const APP_SESSION_ORIGIN_KEY = "signalgen.app-session-origin";
const INSTALLATION_KEY = "signalgen.installation-id";
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
let identityRevision = 0;
const identityListeners = new Set<() => void>();

function identityChanged() {
  identityRevision++;
  for (const listener of identityListeners) listener();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

let authGeneration = 0;
export const session = {
  getToken: () => sessionStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => {
    ++authGeneration;
    identityChanged();
    // A new login must not inherit the previous account's workspace secret.
    // Track the login lifecycle even when the provider reuses a token string.
    session.clearAppSession();
    sessionStorage.setItem(TOKEN_KEY, token);
  },
  setAuth: (
    value: {
      access_token: string;
      refresh_token?: string | null;
      expires_in?: number;
    },
    refreshed = false,
  ) => {
    if (!refreshed) {
      ++authGeneration;
      identityChanged();
      session.clearAppSession();
    }
    sessionStorage.setItem(TOKEN_KEY, value.access_token);
    if (value.refresh_token)
      sessionStorage.setItem(REFRESH_KEY, value.refresh_token);
    else sessionStorage.removeItem(REFRESH_KEY);
    if (value.expires_in && value.expires_in > 0)
      sessionStorage.setItem(
        EXPIRY_KEY,
        String(Date.now() + value.expires_in * 1000),
      );
    else sessionStorage.removeItem(EXPIRY_KEY);
  },
  getRefreshToken: () => sessionStorage.getItem(REFRESH_KEY),
  // Cache isolation uses the verified /me identity, not a decoded JWT claim.
  getIdentityRevision: () => identityRevision,
  getApiOrigin: () => API_ORIGIN || window.location.origin,
  onIdentityChange: (listener: () => void) => {
    identityListeners.add(listener);
    return () => {
      identityListeners.delete(listener);
    };
  },
  needsRefresh: () => {
    const expiry = Number(sessionStorage.getItem(EXPIRY_KEY));
    return Boolean(
      session.getRefreshToken() && expiry && expiry <= Date.now() + 60_000,
    );
  },
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
    ++authGeneration;
    identityChanged();
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
    session.clearAppSession();
  },
};

// Bootstrap requests from concurrent page loaders share one creation. Otherwise
// each creation on this installation revokes the session created just before it.
let pendingAppSession: {
  identity: string | null;
  revision: number;
  promise: Promise<string>;
} | null = null;

async function ensureAppSession(): Promise<string> {
  if (session.needsRefresh()) await refreshAuth();
  const existing = session.getAppSession();
  const storedOrigin = sessionStorage.getItem(APP_SESSION_ORIGIN_KEY);
  if (existing && storedOrigin === (API_ORIGIN || "same-origin"))
    return existing;

  const identity = session.getToken();
  const revision = identityRevision;
  if (
    pendingAppSession?.identity === identity &&
    pendingAppSession.revision === revision
  )
    return pendingAppSession.promise;

  session.clearAppSession();
  const pending = {
    identity,
    revision,
    promise: api
      .createAppSession()
      .then((created) => {
        // Logout/account switching while the server responds must not restore
        // an old secret into the new local account. No credential is logged.
        if (session.getToken() !== identity || identityRevision !== revision)
          throw new ApiError(
            "The account changed. Sign in again if needed.",
            0,
          );
        session.setAppSession(created.session_token);
        return created.session_token;
      })
      .catch((error) => {
        // performRequest also rejects stale responses. Normalize that rejection
        // as a harmless local cancellation for this bootstrap lifecycle.
        if (session.getToken() !== identity || identityRevision !== revision)
          throw new ApiError(
            "The account changed. Sign in again if needed.",
            0,
          );
        throw error;
      }),
  };
  pendingAppSession = pending;
  try {
    return await pending.promise;
  } finally {
    if (pendingAppSession === pending) pendingAppSession = null;
  }
}

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

// Share simultaneous reads only. Never cache authorization or mutation responses.
const pendingReads = new Map<string, Promise<unknown>>();
let tokenRefresh: Promise<void> | null = null;

function unauthorized() {
  session.clear();
  window.dispatchEvent(new Event("signalgen:unauthorized"));
}

// One rotating exchange per tab. Never retry a refresh token automatically.
async function refreshAuth(): Promise<void> {
  if (tokenRefresh) return tokenRefresh;
  const refreshToken = session.getRefreshToken();
  if (!refreshToken)
    throw new ApiError("Your session ended. Sign in again.", 401);
  const identity = session.getToken();
  tokenRefresh = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${API_ORIGIN}/api/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (
        identity !== session.getToken() ||
        refreshToken !== session.getRefreshToken()
      )
        throw new ApiError("Your account changed. Sign in again.", 401);
      if (!response.ok) {
        if (response.status === 401 || response.status === 400) unauthorized();
        throw new ApiError(
          errorDetail(result, response.status),
          response.status,
        );
      }
      if (
        !result.access_token ||
        !result.refresh_token ||
        !(result.expires_in > 0)
      )
        throw new ApiError(
          "Your session could not be refreshed. Try again.",
          503,
        );
      session.setAuth(result, true);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "Connection lost. Your session could not be refreshed. Try again.",
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => {
    tokenRefresh = null;
  });
  return tokenRefresh;
}

function request<T>(
  path: string,
  init: RequestInit = {},
  retryExpiredSession = true,
  rawText = false,
): Promise<T> {
  if (init.method && init.method !== "GET")
    return performRequest<T>(path, init, retryExpiredSession, rawText);
  // A caller-owned abort must not cancel another reader's shared request.
  if (init.signal)
    return readWithRecovery<T>(path, init, retryExpiredSession, rawText);
  const key = JSON.stringify([
    path,
    session.getToken(),
    session.getAppSession(),
    retryExpiredSession,
    rawText,
  ]);
  const existing = pendingReads.get(key);
  if (existing) return existing as Promise<T>;
  const pending = readWithRecovery<T>(
    path,
    init,
    retryExpiredSession,
    rawText,
  ).finally(() => pendingReads.delete(key));
  pendingReads.set(key, pending);
  return pending;
}

// Retry one transient read, never a login, save, session creation or mutation.
// Concurrent callers share this entire recovery through pendingReads above.
async function readWithRecovery<T>(
  path: string,
  init: RequestInit,
  retryExpiredSession: boolean,
  rawText: boolean,
): Promise<T> {
  const identity = authGeneration;
  const appSession = session.getAppSession();
  try {
    return await performRequest<T>(path, init, retryExpiredSession, rawText);
  } catch (error) {
    const transient =
      error instanceof ApiError &&
      (error.code === "NETWORK_ERROR" ||
        error.code === "REQUEST_TIMEOUT" ||
        [502, 503, 504].includes(error.status));
    const eligible = path.startsWith("/api/v1/") || path === "/api/auth/me";
    if (
      !eligible ||
      !transient ||
      identity !== authGeneration ||
      init.signal?.aborted
    )
      throw error;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 300));
    // Logout, account changes or revocation during backoff must stop recovery.
    if (
      identity !== authGeneration ||
      session.getAppSession() !== appSession ||
      init.signal?.aborted
    )
      throw error;
    return performRequest<T>(path, init, retryExpiredSession, rawText);
  }
}

async function performRequest<T>(
  path: string,
  init: RequestInit = {},
  retryExpiredSession = true,
  rawText = false,
): Promise<T> {
  init.signal?.throwIfAborted();
  if (
    session.needsRefresh() &&
    !/^\/api\/auth\/(login|register|refresh|password)/.test(path)
  )
    await refreshAuth();
  init.signal?.throwIfAborted();
  const identity = authGeneration;
  const token = session.getToken();
  const requestIdentityRevision = identityRevision;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const appSession = session.getAppSession();
  if (appSession) headers.set("X-App-Session", appSession);

  let response: Response;
  let text = "";
  let payload: unknown;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const cancel = () => controller.abort();
  init.signal?.addEventListener("abort", cancel, { once: true });
  if (init.signal?.aborted) controller.abort();
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    // Keep the deadline until the response body is read, not just its headers.
    if (rawText) {
      text = await response.text();
      if (!response.ok) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = {};
        }
      }
    } else {
      payload = await response.json().catch((error) => {
        if (controller.signal.aborted) throw error;
        return {};
      });
    }
  } catch {
    if (init.signal?.aborted)
      throw new DOMException("Analysis cancelled.", "AbortError");
    const timedOut = controller.signal.aborted;
    throw new ApiError(
      timedOut
        ? "The server took too long to respond. Try again shortly."
        : "Unable to connect to the service. Check your connection and try again.",
      0,
      timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", cancel);
  }

  // rawText preserves the exact snapshot bytes for checksum verification.
  if (identity !== authGeneration)
    throw new ApiError(
      "Your account changed. The previous request was cancelled.",
      401,
    );
  if (!response.ok) {
    const envelope = errorEnvelope(payload);
    const sameIdentity =
      session.getToken() === token &&
      identityRevision === requestIdentityRevision;
    const currentSessionResponse =
      sameIdentity && session.getAppSession() === appSession;
    const expiredAppSession =
      response.status === 403 && envelope?.code === "SESSION_EXPIRED";
    const revokedAppSession =
      response.status === 403 && envelope?.code === "SESSION_REVOKED";
    const readOnly =
      !init.method || ["GET", "HEAD"].includes(init.method.toUpperCase());
    if (revokedAppSession && currentSessionResponse) {
      // Revocation is an explicit security action, not a reason to silently
      // recreate a workspace session. Require a deliberate login instead.
      session.clear();
      window.dispatchEvent(new Event("signalgen:unauthorized"));
    }
    if (expiredAppSession && currentSessionResponse) session.clearAppSession();
    if (
      retryExpiredSession &&
      expiredAppSession &&
      sameIdentity &&
      readOnly &&
      path !== "/api/v1/sessions"
    ) {
      await api.ensureAppSession();
      return request<T>(path, init, false, rawText);
    }
    const identityRequired =
      path === "/api/auth/me" || path.startsWith("/api/v1/");
    if (response.status === 401 && identityRequired && sameIdentity) {
      if (retryExpiredSession && session.getRefreshToken()) {
        await refreshAuth();
        return performRequest<T>(path, init, false, rawText);
      }
      unauthorized();
    }
    let message = errorDetail(payload, response.status);
    const retryAfter = Number(response.headers.get("Retry-After"));
    if (envelope?.code === "DEVICE_SWITCH_COOLDOWN" && retryAfter > 0)
      message = `You can switch devices after ${new Date(Date.now() + retryAfter * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Use your previous browser or wait until then.`;
    throw new ApiError(
      message,
      response.status,
      envelope?.code,
      envelope?.request_id,
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.max(
            0,
            Date.parse(response.headers.get("Retry-After") ?? "") - Date.now(),
          ) || 0,
    );
  }
  return (rawText ? text : payload) as T;
}

function errorDetail(payload: unknown, status: number): string {
  const detail =
    payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail
      : undefined;
  const apiError = errorEnvelope(payload);
  if (apiError?.code === "DEVICE_SWITCH_COOLDOWN")
    return "You can switch devices once per day.";
  if (apiError?.code === "DEVICE_MISMATCH")
    return "Your device network changed. Sign in again from the registered network.";
  if (apiError?.code === "ENTITLEMENT_REQUIRED")
    return "Your account does not have screener access.";
  if (apiError?.code === "SESSION_EXPIRED")
    return "Your workspace session expired. Try the action again to reconnect.";
  if (apiError?.code === "SESSION_REVOKED")
    return "This workspace session was revoked. Sign in again to continue.";
  if (apiError?.code === "ROLE_REQUIRED")
    return "Your account role does not allow this screening action.";
  if (apiError?.code === "RATE_LIMITED")
    return "Too many requests were sent. Wait a moment, then try again.";
  if (apiError?.code === "SERVICE_UNAVAILABLE")
    return "The service is temporarily unavailable. Try again shortly.";
  if (apiError?.code === "REQUEST_TIMEOUT")
    return "The server took too long to respond. Try again shortly.";
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
  refreshIfNeeded: async () => {
    if (session.needsRefresh()) await refreshAuth();
  },
  status: () => request<ApiStatus>("/api"),
  readiness: () => request<{ status: "ready" }>("/ready"),
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
  me: (signal?: AbortSignal) => request<User>("/api/auth/me", { signal }),
  workspace: () =>
    request<{
      items: {
        kind: string;
        data: unknown;
        version: number;
        updated_at: string;
      }[];
    }>("/api/v1/workspace"),
  saveWorkspace: (kind: string, version: number, data: unknown) =>
    request<{
      kind: string;
      data: unknown;
      version: number;
      updated_at: string;
    }>(`/api/v1/workspace/${encodeURIComponent(kind)}`, {
      method: "PUT",
      body: JSON.stringify({ version, data }),
    }),
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
  ensureAppSession,
  revokeCurrentAppSession: () =>
    request<void>("/api/v1/sessions/current", { method: "DELETE" }),
  account: () => request<AccountState>("/api/v1/account/me"),
  getProfile: () => request<EditableProfile>("/api/v1/account/profile"),
  updateProfile: (version: number, displayName: string) =>
    request<EditableProfile>("/api/v1/account/profile", {
      method: "PATCH",
      // The server derives owner. Do not send user ID, role or Auth metadata.
      body: JSON.stringify({ version, display_name: displayName }),
    }),
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
  getRule: (id: string, signal?: AbortSignal) =>
    request<RuleResource>(`/api/v1/rules/${encodeURIComponent(id)}`, {
      signal,
    }),
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
  prepareDataset: (
    ruleId: string,
    universeId: string,
    timeframe?: import("@/types").ScreenerTimeframe,
    signal?: AbortSignal,
  ) =>
    request<DatasetManifest>("/api/v1/datasets/prepare", {
      method: "POST",
      body: JSON.stringify({
        purpose: "screen",
        rule_id: ruleId,
        universe_id: universeId,
        ...(timeframe ? { timeframe } : {}),
      }),
      signal,
    }),
  getDatasetContent: (datasetId: string) =>
    request<DatasetContent>(
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/content`,
    ),
  getDatasetManifest: (datasetId: string, signal?: AbortSignal) =>
    request<DatasetManifest>(
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/manifest`,
      { signal },
    ),
  getDatasetContentText: (datasetId: string, signal?: AbortSignal) =>
    request<string>(
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/content`,
      { signal },
      true,
      true,
    ),
  createComputeGrant: (
    manifest: DatasetManifest,
    rule: RuleResource,
    signal?: AbortSignal,
  ) =>
    request<ComputeGrant>("/api/v1/compute-grants", {
      method: "POST",
      signal,
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
  createScreenerSocketTicket: (computeGrantId: string, signal?: AbortSignal) =>
    request<ScreenerSocketTicket>("/api/v1/screener/socket-tickets", {
      method: "POST",
      signal,
      body: JSON.stringify({
        compute_grant_id: computeGrantId,
        protocol: "screener-private-1",
      }),
    }),
  listSubscriptionPlans: () =>
    request<{ items: SubscriptionPlan[] }>("/api/v1/subscription/plans"),
  currentSubscription: () =>
    request<{ subscription: Subscription | null }>("/api/v1/subscription"),
  resourceUsage: () =>
    request<import("@/types").ResourceUsage>("/api/v1/subscription/usage"),
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
