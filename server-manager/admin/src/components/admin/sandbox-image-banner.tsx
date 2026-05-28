"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, Hammer } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { api, API } from "@/lib/api";
import { BuildStreamDialog } from "@/components/admin/build-stream-dialog";

interface ImageHealth {
  missing_required?: string[];
}

// Global guardrail banner: shows across the whole admin UI whenever a REQUIRED
// sandbox/orchestrator image tag is missing. Keyed on `missing_required` so
// absent-but-optional tags (core/local) don't cry wolf.
//
// 2026-05-28: the button used to navigate to /orchestrator-sandboxes where the
// operator had to find the right rebuild button (and several were ambiguously
// labeled — see commit). Now it rebuilds the missing image(s) INLINE via a
// streaming dialog, with dependency order handled automatically (e.g. core
// gets built first if aidream needs it). On success, the banner disappears
// because the next health-check returns missing_required = [].
export function SandboxImageBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    api<ImageHealth>(API.SANDBOX_IMAGES_HEALTH)
      .then((h) => setMissing(h.missing_required ?? []))
      .catch(() => { /* health unreachable — stay silent rather than false-alarm */ });
  }, []);

  useEffect(() => {
    let active = true;
    refresh();
    const t = setInterval(() => { if (active) refresh(); }, 60000);
    return () => { active = false; clearInterval(t); };
  }, [refresh]);

  if (missing.length === 0) return null;

  return (
    <>
      <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
        <span>
          Missing required sandbox image(s): <b>{missing.join(", ")}</b> — sandbox spawning will fail until rebuilt.
        </span>
        <Button
          size="sm"
          variant="destructive"
          className="ml-auto h-7"
          onClick={() => setOpen(true)}
        >
          <Hammer className="size-3.5" /> Rebuild {missing.length === 1 ? missing[0] : "missing images"} now
        </Button>
      </div>
      {open && (
        <BuildStreamDialog
          open={open}
          onOpenChange={setOpen}
          url={API.SANDBOX_IMAGES_REBUILD_MISSING_STREAM()}
          title={`Rebuilding ${missing.join(", ")}`}
          description="Builds missing required sandbox images in dependency order (core → aidream). The aidream build is large — expect several minutes. Sandbox containers in flight are untouched."
          onComplete={refresh}
        />
      )}
    </>
  );
}
