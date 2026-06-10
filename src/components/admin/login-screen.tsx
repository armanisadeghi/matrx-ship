"use client";

import { useState, useEffect } from "react";
import { Loader2, LogIn, ChevronDown, ShieldCheck, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";

interface AuthConfig {
  oauth_enabled: boolean;
  aidream_url: string;
  operator_login: boolean;
}

export function LoginScreen() {
  const { login } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    fetch("/api/auth-config")
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg({ oauth_enabled: false, aidream_url: "", operator_login: true }));
  }, []);

  function handleOAuth() {
    if (!cfg?.aidream_url) return;
    setRedirecting(true);
    const callback = `${window.location.origin}/admin/oauth/callback`;
    window.location.href = `${cfg.aidream_url}/auth/aimatrx?app_redirect=${encodeURIComponent(callback)}`;
  }

  async function handleTokenLogin() {
    setLoading(true);
    setError(null);
    const ok = await login(token.trim());
    if (!ok) setError("Invalid or expired credentials, or you are not an authorized admin.");
    setLoading(false);
  }

  const oauth = cfg?.oauth_enabled;

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-[420px]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-gradient-to-br from-ship-500 to-ship-700 flex items-center justify-center">
            <Package className="w-6 h-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-xl">Matrx Ship Admin</CardTitle>
          <CardDescription>
            {oauth
              ? "Sign in with your AI Matrx admin account."
              : "Enter your admin secret to access the dashboard."}
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

          {/* Operator-secret entry: primary when OAuth is off, an "advanced"
              break-glass fallback when OAuth is on. */}
          {oauth ? (
            (cfg?.operator_login ?? true) && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="flex w-full items-center justify-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  aria-expanded={showToken}
                >
                  Advanced — sign in with an operator secret
                  <ChevronDown className={`h-3 w-3 transition-transform ${showToken ? "rotate-180" : ""}`} />
                </button>
                {showToken && (
                  <TokenForm token={token} setToken={setToken} error={error} setError={setError} loading={loading} onSubmit={handleTokenLogin} />
                )}
              </div>
            )
          ) : (
            <TokenForm token={token} setToken={setToken} error={error} setError={setError} loading={loading} onSubmit={handleTokenLogin} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TokenForm({
  token, setToken, error, setError, loading, onSubmit,
}: {
  token: string;
  setToken: (v: string) => void;
  error: string | null;
  setError: (v: string | null) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3 pt-2">
      {error && <p className="text-destructive text-sm text-center">{error}</p>}
      <Input
        type="password"
        value={token}
        onChange={(e) => { setToken(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder="Admin secret…"
        className="font-mono"
      />
      <Button onClick={onSubmit} disabled={loading || !token.trim()} variant="secondary" className="w-full">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Sign in
      </Button>
    </div>
  );
}
