import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Me } from "../types";

/** Which door the session came through: the public log-in (a customer) or the console's own page (the operator). */
export type SessionKind = "tenant" | "operator";

interface AuthState {
  token: string | null;
  kind: SessionKind | null;
  me: Me | null;
  setToken: (t: string, kind: SessionKind) => void;
  setMe: (me: Me | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      kind: null,
      me: null,
      setToken: (token, kind) => set({ token, kind }),
      // who-am-I is the truth; it also fills in `kind` for sessions saved before it existed
      setMe: (me) => set(me ? { me, kind: me.role === "superadmin" ? "operator" : "tenant" } : { me }),
      logout: () => set({ token: null, kind: null, me: null }),
    }),
    // The token and its kind are persisted; who-am-I is re-fetched so a changed role or plan shows up at once
    { name: "cb-auth", partialize: (s) => ({ token: s.token, kind: s.kind }) }
  )
);

/** Where a signed-out visitor of this kind logs in. The console's page is linked from nowhere public. */
export const loginPathFor = (kind: SessionKind | null) => (kind === "operator" ? "/console" : "/login");
