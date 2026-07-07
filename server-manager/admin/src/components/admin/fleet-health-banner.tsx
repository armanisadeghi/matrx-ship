"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { api, API } from "@/lib/api";

interface Check { id: string; label: string; status: string; detail: string }
interface FleetHealth { overall?: string; checks?: Check[] }

// Global fleet banner: shows across the admin UI whenever a check is critical
// (or degraded). This is the "tell me before I find out the hard way" surface —
// stale code/drift, failed deploys, missing images. Silent when everything's ok.
//
// Restart-aware: when the Manager itself just restarted a service (Secrets
// "Apply", orchestrator restart/rebuild), the backend reports those checks as
// "restarting" — shown here as a CALM blue notice, not the red alarm. Red is
// reserved for problems nobody asked for. If the service is still down after
// the expected window (~2.5 min) it escalates to critical for real.
export function FleetHealthBanner() {
  const [bad, setBad] = useState<Check[]>([]);
  const [restarting, setRestarting] = useState<Check[]>([]);
  const [overall, setOverall] = useState<string>("ok");

  useEffect(() => {
    let active = true;
    const check = () =>
      api<FleetHealth>(API.FLEET_HEALTH)
        .then((d) => {
          if (!active) return;
          setOverall(d.overall || "ok");
          setBad((d.checks || []).filter((c) => c.status === "critical"));
          setRestarting((d.checks || []).filter((c) => c.status === "restarting"));
        })
        .catch(() => { /* stay silent if the API is unreachable */ });
    check();
    const t = setInterval(check, 30000);
    return () => { active = false; clearInterval(t); };
  }, []);

  if (bad.length > 0) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-destructive">Fleet health: {bad.length} critical issue{bad.length > 1 ? "s" : ""}.</span>{" "}
          <span className="text-muted-foreground">{bad.map((c) => c.label).join(" · ")}</span>
        </div>
        <Link href="/fleet-health" className="whitespace-nowrap font-medium text-destructive underline">Fix it →</Link>
      </div>
    );
  }

  if (restarting.length > 0) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm">
        <RotateCcw className="mt-0.5 size-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" style={{ animationDuration: "2.5s" }} />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-blue-700 dark:text-blue-300">
            Restarting: {restarting.map((c) => c.label).join(" · ")}.
          </span>{" "}
          <span className="text-muted-foreground">
            You (or a deploy) just restarted this — expected to clear within a minute. No action needed; it escalates on its own if something is actually wrong.
          </span>
        </div>
      </div>
    );
  }

  if (overall === "ok") return null;
  return null;
}
