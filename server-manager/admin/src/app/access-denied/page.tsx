"use client";

import { useEffect, useState } from "react";
import { ShieldX } from "lucide-react";

// aidream's OAuth broker redirects here when a signed-in AI Matrx user is NOT
// in public.admins. Served at /admin/access-denied (a next.config redirect maps
// the broker's bare /access-denied here).
export default function AccessDeniedPage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("email");
    setEmail(e ? decodeURIComponent(e) : null);
  }, []);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <ShieldX className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground">
          {email ? <><span className="font-mono">{email}</span> is signed in, but isn&apos;t an authorized administrator of this server.</> : "Your account isn't an authorized administrator of this server."}
        </p>
        <p className="text-xs text-muted-foreground">Ask a super-admin to add you to the admins list.</p>
        <a href="/admin/instances" className="mt-2 text-sm text-primary underline-offset-4 hover:underline">
          Back to sign in
        </a>
      </div>
    </div>
  );
}
