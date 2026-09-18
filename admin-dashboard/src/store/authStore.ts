import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Me } from "../types";

interface AuthState {
  token: string | null;
  me: Me | null;
  setToken: (t: string) => void;
  setMe: (me: Me | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      me: null,
      setToken: (token) => set({ token }),
      setMe: (me) => set({ me }),
      logout: () => set({ token: null, me: null }),
    }),
    // Only the token is persisted; who-am-I is re-fetched so a changed role or plan shows up at once
    { name: "cb-auth", partialize: (s) => ({ token: s.token }) }
  )
);
