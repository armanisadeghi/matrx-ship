"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

// Receives the OAuth redirect from aidream's broker:
//   success -> /admin/oauth/callback?access_token=<Supabase JWT>
//   failure -> /admin/oauth/callback?error=<message>
// Exchanges the token for an HttpOnly session cookie via /api/admin/session,
// scrubs the token from the URL, then bounces to the dashboard. The token never
// touches localStorage — only the server-set cookie persists the session.
export default function OAuthCallbackPage() {
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("access_token");
    const err = params.get("error");

    if (err) {
      setMessage(decodeURIComponent(err));
      setStatus("error");
      return;
    }
    if (!token) {
      setMessage("No access token received.");
      setStatus("error");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/admin/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ access_token: token }),
        });
        // Scrub the token from the URL/history immediately, regardless of outcome.
        window.history.replaceState({}, "", window.location.pathname);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setMessage(body.error || "Sign in failed.");
          setStatus("error");
          return;
        }
        setStatus("ok");
        setTimeout(() => { window.location.href = "/admin"; }, 500);
      } catch {
        setMessage("Network error completing sign in.");
        setStatus("error");
      }
    })();
  }, []);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-4 text-center">
        {status === "working" && (
          <>
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Completing sign in…</p>
          </>
        )}
        {status === "ok" && (
          <>
            <CheckCircle2 className="size-8 text-green-500" />
            <p className="text-sm text-muted-foreground">Signed in. Redirecting…</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="size-8 text-destructive" />
            <p className="font-medium text-destructive">Sign in failed</p>
            <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
            <a href="/admin" className="mt-2 text-sm text-primary underline-offset-4 hover:underline">
              Back to sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
