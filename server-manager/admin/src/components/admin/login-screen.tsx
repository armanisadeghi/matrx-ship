"use client";

import { useState, useEffect } from "react";
import { Loader2, LogIn, ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Input } from "@matrx/admin-ui/ui/input";
import { useAuth } from "@/lib/auth-context";
import { api, API } from "@/lib/api";

interface AuthConfig {
  oauth_enabled: boolean;
  aidream_url: string;
}

export function LoginScreen() {
  const { login } = useAuth();
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    api<AuthConfig>(API.AUTH_CONFIG)
      .then(setCfg)
      .catch(() => setCfg({ oauth_enabled: false, aidream_url: "" }));
  }, []);

  function handleOAuth() {
    if (!cfg?.aidream_url) return;
    setRedirecting(true);
    const callback = `${window.location.origin}/admin/oauth/callback`;
    window.location.href = `${cfg.aidream_url}/auth/aimatrx?app_redirect=${encodeURIComponent(callback)}`;
  }

  async function handleLogin() {
    setLoading(true);
    const success = await login(token);
    if (!success) setError(true);
    setLoading(false);
  }

  const oauth = cfg?.oauth_enabled;

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-[420px]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 rounded-2xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/admin/matrx-icon-purple.svg" alt="Matrx Logo" className="w-12 h-12" />
          </div>
          <CardTitle className="text-xl">Matrx Server Manager</CardTitle>
          <CardDescription>
            {oauth ? "Sign in with your AI Matrx admin account." : "Enter your token to access the admin dashboard."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {oauth && (
            <>
              <Button onClick={handleOAuth} disabled={redirecting} className="w-full">
                {redirecting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Continue with AI Matrx
              </Button>
              <p className="text-center text-xs text-muted-foreground">Access is restricted to administrators.</p>
            </>
          )}

          {/* Operator-token entry: primary when OAuth is off, an "advanced"
              break-glass fallback when OAuth is on. */}
          {oauth ? (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="flex w-full items-center justify-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                aria-expanded={showToken}
              >
                Advanced — sign in with an operator token
                <ChevronDown className={`h-3 w-3 transition-transform ${showToken ? "rotate-180" : ""}`} />
              </button>
              {showToken && (
                <TokenForm
                  token={token}
                  setTokenValue={setTokenValue}
                  error={error}
                  setError={setError}
                  loading={loading}
                  handleLogin={handleLogin}
                />
              )}
            </div>
          ) : (
            <TokenForm
              token={token}
              setTokenValue={setTokenValue}
              error={error}
              setError={setError}
              loading={loading}
              handleLogin={handleLogin}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TokenForm({
  token, setTokenValue, error, setError, loading, handleLogin,
}: {
  token: string;
  setTokenValue: (v: string) => void;
  error: boolean;
  setError: (v: boolean) => void;
  loading: boolean;
  handleLogin: () => void;
}) {
  return (
    <div className="space-y-3 pt-2">
      {error && <p className="text-destructive text-sm text-center">Invalid or expired token</p>}
      <Input
        type="password"
        value={token}
        onChange={(e) => { setTokenValue(e.target.value); setError(false); }}
        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        placeholder="Operator token..."
        className="font-mono"
      />
      <Button onClick={handleLogin} disabled={loading || !token.trim()} variant="secondary" className="w-full">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Sign in with token
      </Button>
    </div>
  );
}
