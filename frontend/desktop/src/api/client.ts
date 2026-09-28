import type { ApiStatus, LoginResponse, RegisterResponse, User } from "../types";

const TOKEN_KEY = "signalgen.access-token";
const API_ORIGIN = import.meta.env.DEV ? "" : "http://127.0.0.1:3456";

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
  try {
    response = await fetch(`${API_ORIGIN}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Backend tidak dapat dijangkau. Pastikan Docker aktif.", 0);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") {
      session.clear();
      window.dispatchEvent(new Event("signalgen:unauthorized"));
    }
    throw new ApiError(payload.detail ?? "Permintaan gagal diproses.", response.status);
  }
  return payload as T;
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
  me: () => request<User>("/api/auth/me"),
};
