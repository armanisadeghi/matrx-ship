"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { api, API } from "@/lib/api";

interface ImageHealth {
  missing_required?: string[];
}

// Global guardrail banner: shows across the whole admin UI whenever a REQUIRED
// sandbox/orchestrator image tag is missing (the 2026-04-30 incident condition).
// Keyed on `missing_required` so absent-but-optional tags (core/local) don't
// cry wolf. Renders nothing in the healthy case.
export function SandboxImageBanner() {
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const check = () =>
      api<ImageHealth>(API.SANDBOX_IMAGES_HEALTH)
        .then((h) => { if (active) setMissing(h.missing_required ?? []); })
        .catch(() => { /* health unreachable — stay silent rather than false-alarm */ });
    check();
    const t = setInterval(check, 60000);
    return () => { active = false; clearInterval(t); };
  }, []);

  if (missing.length === 0) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <span>
        Missing required sandbox image(s): <b>{missing.join(", ")}</b> — sandbox spawning will fail until rebuilt.
      </span>
      <Link href="/sandbox-images" className="ml-auto whitespace-nowrap font-medium text-destructive underline">
        Rebuild now →
      </Link>
    </div>
  );
}
