import type { ApiStatus, LoginResponse, RegisterResponse, User } from "../types";

const TOKEN_KEY = "signalgen.web.access-token";
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export const session = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

function errorMessage(status: number, detail: unknown) {
  const normalized = typeof detail === "string" ? detail.toLowerCase() : "";
  if (status === 401) return "Email atau password tidak cocok. Periksa kembali lalu coba masuk lagi.";
  if (normalized.includes("already") || normalized.includes("registered")) return "Email ini sudah terdaftar. Gunakan menu Masuk atau email lain.";
  if (normalized.includes("password")) return "Password belum memenuhi ketentuan. Gunakan minimal 6 karakter dan coba lagi.";
  if (status === 422) return "Data akun belum valid. Periksa nama, format email, dan password.";
  if (status >= 500) return "Server sedang mengalami kendala. Tunggu sebentar lalu coba lagi.";
  return "Permintaan belum berhasil. Periksa data Anda lalu coba lagi.";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = session.getToken();
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Server SignalGen belum dapat dijangkau. Coba lagi setelah backend aktif.", 0);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") {
      session.clear();
      window.dispatchEvent(new Event("signalgen:unauthorized"));
    }
    throw new ApiError(errorMessage(response.status, payload.detail), response.status);
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
