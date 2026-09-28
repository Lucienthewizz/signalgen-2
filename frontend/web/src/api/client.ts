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
  RuleResource,
  ScreenerSocketTicket,
} from "../types";

const TOKEN_KEY = "signalgen.access-token";
const APP_SESSION_KEY = "signalgen.app-session";
const INSTALLATION_KEY = "signalgen.installation-id";
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export const session = {
  getToken: () => sessionStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  getAppSession: () => sessionStorage.getItem(APP_SESSION_KEY),
  setAppSession: (token: string) =>
    sessionStorage.setItem(APP_SESSION_KEY, token),
  clearAppSession: () => sessionStorage.removeItem(APP_SESSION_KEY),
  getInstallationId: () => {
    const existing = localStorage.getItem(INSTALLATION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, created);
    return created;
  },
  clear: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(APP_SESSION_KEY);
  },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (response.status === 401 && path !== "/api/auth/login") {
      session.clear();
      window.dispatchEvent(new Event("signalgen:unauthorized"));
    }
    throw new ApiError(errorDetail(payload, response.status), response.status);
  }
  return payload as T;
}

function errorDetail(payload: unknown, status: number): string {
  const detail =
    payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail
      : undefined;
  const apiError =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { code?: string; message?: string } }).error
      : undefined;
  if (apiError?.code === "DEVICE_SWITCH_COOLDOWN")
    return "Perangkat hanya dapat dipindahkan satu kali per hari.";
  if (apiError?.code === "DEVICE_MISMATCH")
    return "Jaringan perangkat berubah. Masuk kembali dari jaringan yang terdaftar.";
  if (apiError?.code === "ENTITLEMENT_REQUIRED")
    return "Akun ini belum memiliki akses fitur screener.";
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
    if (existing) return existing;
    const created = await api.createAppSession();
    session.setAppSession(created.session_token);
    return created.session_token;
  },
  revokeCurrentAppSession: () =>
    request<void>("/api/v1/sessions/current", { method: "DELETE" }),
  account: () => request<AccountState>("/api/v1/account/me"),
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
  prepareDataset: () =>
    request<DatasetManifest>("/api/v1/datasets/prepare", {
      method: "POST",
      body: JSON.stringify({
        purpose: "screen",
        market: "IDX",
        symbols: ["BBCA.JK"],
        timeframe: "1d",
        date_from: "2026-01-01",
        date_to: "2026-02-09",
        rule_id: "default-scalping-v1",
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
