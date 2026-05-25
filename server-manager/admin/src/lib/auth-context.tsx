"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api, setToken, clearToken, API } from "@/lib/api";

interface MeResponse {
  authenticated: boolean;
  email: string | null;
  role: string | null;
  is_superadmin: boolean;
  auth_kind: string | null;
  level: string | null;
}

interface AuthContextValue {
  authed: boolean;
  loading: boolean;
  role: string;
  isSuperadmin: boolean;
  email: string | null;
  authKind: string | null;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("viewer");
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [authKind, setAuthKind] = useState<string | null>(null);

  function applyMe(me: MeResponse) {
    setAuthed(true);
    setRole(me.role || "admin");
    setIsSuperadmin(!!me.is_superadmin);
    setEmail(me.email);
    setAuthKind(me.auth_kind);
  }

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("manager_token") : null;
    if (token) {
      setToken(token);
      api<MeResponse>(API.ME)
        .then((me) => applyMe(me))
        .catch(() => clearToken())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function login(tokenValue: string): Promise<boolean> {
    try {
      setToken(tokenValue);
      const me = await api<MeResponse>(API.ME);
      applyMe(me);
      return true;
    } catch {
      clearToken();
      return false;
    }
  }

  function logout() {
    clearToken();
    setAuthed(false);
    setRole("viewer");
    setIsSuperadmin(false);
    setEmail(null);
    setAuthKind(null);
  }

  return (
    <AuthContext.Provider value={{ authed, loading, role, isSuperadmin, email, authKind, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
