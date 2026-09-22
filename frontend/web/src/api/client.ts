import type {
  ApiStatus,
  LoginResponse,
  RegisterResponse,
  MessageResponse,
  User,
} from "../types";

const TOKEN_KEY = "signalgen.access-token";
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
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = session.getToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

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
    throw new ApiError(
      errorDetail(payload.detail, response.status),
      response.status,
    );
  }
  return payload as T;
}

function errorDetail(detail: unknown, status: number): string {
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
};
