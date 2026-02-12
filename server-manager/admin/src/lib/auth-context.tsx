"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api, setToken, clearToken, API } from "@/lib/api";

interface AuthContextValue {
  authed: boolean;
  loading: boolean;
  role: string;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("viewer");

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("manager_token") : null;
    if (token) {
      setToken(token);
      api(API.SYSTEM)
        .then(() => {
          setAuthed(true);
          setRole("admin");
          setLoading(false);
        })
        .catch(() => {
          clearToken();
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  async function login(tokenValue: string): Promise<boolean> {
    try {
      setToken(tokenValue);
      await api(API.SYSTEM);
      setAuthed(true);
      setRole("admin");
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
  }

  return (
    <AuthContext.Provider value={{ authed, loading, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
