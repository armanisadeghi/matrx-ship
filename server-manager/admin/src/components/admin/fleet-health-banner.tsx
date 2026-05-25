"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { api, API } from "@/lib/api";

interface Check { id: string; label: string; status: string; detail: string }
interface FleetHealth { overall?: string; checks?: Check[] }

// Global fleet banner: shows across the admin UI whenever a check is critical
// (or degraded). This is the "tell me before I find out the hard way" surface —
// stale code/drift, failed deploys, missing images. Silent when everything's ok.
export function FleetHealthBanner() {
  const [bad, setBad] = useState<Check[]>([]);
  const [overall, setOverall] = useState<string>("ok");

  useEffect(() => {
    let active = true;
    const check = () =>
      api<FleetHealth>(API.FLEET_HEALTH)
        .then((d) => {
          if (!active) return;
          setOverall(d.overall || "ok");
          setBad((d.checks || []).filter((c) => c.status === "critical"));
        })
        .catch(() => { /* stay silent if the API is unreachable */ });
    check();
    const t = setInterval(check, 30000);
    return () => { active = false; clearInterval(t); };
  }, []);

  if (overall === "ok" || bad.length === 0) return null;

  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-destructive">Fleet health: {bad.length} critical issue{bad.length > 1 ? "s" : ""}.</span>{" "}
        <span className="text-muted-foreground">{bad.map((c) => c.label).join(" · ")}</span>
      </div>
      <Link href="/fleet-health" className="whitespace-nowrap font-medium text-destructive underline">Details →</Link>
    </div>
  );
}
