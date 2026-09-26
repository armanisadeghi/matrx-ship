"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { runOAuthCallback } from "@/lib/oauth-handoff";

// Receives the OAuth redirect from aidream's broker:
//   success -> /admin/oauth/callback?handoff=<one-time code>
//   failure -> /admin/oauth/callback?error=<message>
// The handoff is exchanged with AI Dream and its response token is verified with
// the Manager before storage. Tokens in URL parameters are always rejected.
export default function OAuthCallbackPage() {
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("");
  const callbackLocation = useRef<{ search: string; pathname: string } | null>(null);

  useEffect(() => {
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    callbackLocation.current ??= { search: window.location.search, pathname: window.location.pathname };
    let active = true;
    let cleanup: (() => void) | undefined;

    // Strict Mode immediately tears down and replays effects in development.
    // Deferring one microtask means that replay starts a single exchange rather
    // than consuming the one-time handoff in the discarded setup.
    queueMicrotask(() => {
      if (!active || !callbackLocation.current) return;
      cleanup = runOAuthCallback({
        search: callbackLocation.current.search,
        pathname: callbackLocation.current.pathname,
        scrubUrl: (pathname) => window.history.replaceState({}, "", pathname),
        removeStoredToken: () => localStorage.removeItem("manager_token"),
        storeToken: (token) => localStorage.setItem("manager_token", token),
        setStatus: (nextStatus, nextMessage) => {
          if (nextMessage) setMessage(nextMessage);
          setStatus(nextStatus);
          if (nextStatus === "ok") redirectTimer = setTimeout(() => { window.location.href = "/admin/instances"; }, 600);
        },
      });
    });
    return () => {
      active = false;
      cleanup?.();
      if (redirectTimer) clearTimeout(redirectTimer);
    };
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
            <a href="/admin/instances" className="mt-2 text-sm text-primary underline-offset-4 hover:underline">
              Back to sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
