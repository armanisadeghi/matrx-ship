"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface MeResponse {
  authenticated: boolean;
  email: string | null;
  role: string | null;
  is_superadmin: boolean;
  level: string | null;
  auth_kind: string | null;
}

interface AuthContextValue {
  authed: boolean;
  loading: boolean;
  email: string | null;
  isSuperadmin: boolean;
  authKind: string | null;
  /** Exchange a Supabase access token (or operator secret) for a session cookie. */
  login: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [authKind, setAuthKind] = useState<string | null>(null);

  const applyMe = useCallback((me: MeResponse) => {
    setAuthed(true);
    setEmail(me.email);
    setIsSuperadmin(!!me.is_superadmin);
    setAuthKind(me.auth_kind);
  }, []);

  const clear = useCallback(() => {
    setAuthed(false);
    setEmail(null);
    setIsSuperadmin(false);
    setAuthKind(null);
  }, []);

  // The session lives in an HttpOnly cookie, so we ask the server who we are.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/me", { credentials: "same-origin" });
      if (!res.ok) { clear(); return; }
      const me = (await res.json()) as MeResponse;
      if (me.authenticated) applyMe(me); else clear();
    } catch {
      clear();
    }
  }, [applyMe, clear]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (token: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ access_token: token }),
      });
      if (!res.ok) { clear(); return false; }
      await refresh();
      return true;
    } catch {
      clear();
      return false;
    }
  }, [clear, refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" });
    } catch { /* ignore */ }
    clear();
  }, [clear]);

  return (
    <AuthContext.Provider value={{ authed, loading, email, isSuperadmin, authKind, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
