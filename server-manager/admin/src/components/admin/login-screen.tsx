"use client";

import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Input } from "@matrx/admin-ui/ui/input";
import { useAuth } from "@/lib/auth-context";

export function LoginScreen() {
  const { login } = useAuth();
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    const success = await login(token);
    if (!success) {
      setError(true);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-[420px]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 rounded-2xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/admin/matrx-icon-purple.svg" alt="Matrx Logo" className="w-12 h-12" />
          </div>
          <CardTitle className="text-xl">Matrx Server Manager</CardTitle>
          <CardDescription>Enter your token to access the admin dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-destructive text-sm text-center">Invalid or expired token</p>}
          <Input
            type="password"
            value={token}
            onChange={(e) => { setTokenValue(e.target.value); setError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Bearer token..."
            className="font-mono"
            autoFocus
          />
          <Button onClick={handleLogin} disabled={loading} className="w-full">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Sign In
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
