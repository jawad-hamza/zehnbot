import axios from "axios";
import { useAuthStore } from "../store/authStore";

export const api = axios.create({
  baseURL: "/api",
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// A 401 from these means "wrong password", not "your session ended"
const CREDENTIAL_ENDPOINTS = ["/auth/login", "/auth/signup", "/auth/change-credentials"];

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url: string = err.config?.url ?? "";
    const sessionEnded = err.response?.status === 401 && !CREDENTIAL_ENDPOINTS.some((p) => url.startsWith(p));
    if (sessionEnded) {
      useAuthStore.getState().logout();
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

/** The server's explanation for a failed request, when it gave one. */
export function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  // FastAPI validation errors arrive as a list of { msg, loc }
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d: { msg?: string; loc?: (string | number)[] }) => {
        const field = d.loc?.[d.loc.length - 1];
        const msg = (d.msg ?? "").replace(/^Value error, /, "");
        return field && typeof field === "string" ? `${field}: ${msg}` : msg;
      })
      .join("\n");
  }
  return fallback;
}
