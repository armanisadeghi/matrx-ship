"use client";

import { useState } from "react";
import { Rocket, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

interface LoginScreenProps {
  onLogin: () => void;
  api: (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;
}

export function LoginScreen({ onLogin, api }: LoginScreenProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState(false);

  async function handleLogin() {
    try {
      localStorage.setItem("deploy_token", token);
      await api("/api/health");
      await api("/api/system");
      onLogin();
    } catch {
      setError(true);
      localStorage.removeItem("deploy_token");
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <Card className="w-full max-w-[420px] mx-4">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-gradient-to-br from-ship-500 to-ship-700 rounded-xl flex items-center justify-center mb-3">
            <Rocket className="size-6 text-white" />
          </div>
          <CardTitle className="text-xl">Matrx Deploy</CardTitle>
          <CardDescription>Enter your admin token to access deploy management.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-destructive text-sm text-center">Invalid token</p>}
          <input
            type="password"
            value={token}
            onChange={(e) => { setToken(e.target.value); setError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Bearer token..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <Button onClick={handleLogin} className="w-full">
            <LogIn className="size-4" /> Sign In
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
