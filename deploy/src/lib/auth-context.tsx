"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

interface AuthContextValue {
  token: string;
  authed: boolean;
  loading: boolean;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
  api: (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);

  const api = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      const t = typeof window !== "undefined" ? localStorage.getItem("deploy_token") || "" : "";
      const res = await fetch(path, {
        ...opts,
        headers: {
          Authorization: `Bearer ${t}`,
          "Content-Type": "application/json",
          ...opts.headers,
        },
        body: opts.body
          ? typeof opts.body === "string"
            ? opts.body
            : JSON.stringify(opts.body)
          : undefined,
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (res.status === 401) {
        setAuthed(false);
        setToken("");
        localStorage.removeItem("deploy_token");
        throw new Error("Unauthorized");
      }
      return data;
    },
    [],
  );

  const login = useCallback(
    async (newToken: string) => {
      try {
        localStorage.setItem("deploy_token", newToken);
        setToken(newToken);
        await fetch("/api/system", {
          headers: { Authorization: `Bearer ${newToken}` },
        }).then((r) => {
          if (!r.ok) throw new Error("Unauthorized");
          return r.json();
        });
        setAuthed(true);
        return true;
      } catch {
        localStorage.removeItem("deploy_token");
        setToken("");
        setAuthed(false);
        return false;
      }
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("deploy_token");
    setToken("");
    setAuthed(false);
  }, []);

  // Check existing token on mount
  useEffect(() => {
    const existingToken = localStorage.getItem("deploy_token");
    if (existingToken) {
      setToken(existingToken);
      fetch("/api/system", {
        headers: { Authorization: `Bearer ${existingToken}` },
      })
        .then((r) => {
          if (r.ok) {
            setAuthed(true);
          } else {
            localStorage.removeItem("deploy_token");
          }
        })
        .catch(() => {
          localStorage.removeItem("deploy_token");
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ token, authed, loading, login, logout, api }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
