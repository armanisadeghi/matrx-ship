"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, Hammer } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { api, API } from "@/lib/api";
import { BuildStreamDialog } from "@/components/admin/build-stream-dialog";

interface ImageHealth {
  missing_required?: string[];
  orchestrator_missing?: boolean;
}

// Global guardrail banner: shows across the whole admin UI whenever a required
// sandbox template or the hosted orchestrator recovery image is missing.
// Those states are deliberately separate: a missing template breaks spawning
// from that template; a missing orchestrator tag makes the next recreate unsafe.
//
// 2026-05-28: the button used to navigate to /orchestrator-sandboxes where the
// operator had to find the right rebuild button (and several were ambiguously
// labeled — see commit). Now it rebuilds the missing image(s) INLINE via a
// streaming dialog, with dependency order handled automatically (e.g. core
// gets built first if aidream needs it). On success, the banner disappears
// because the next health-check clears the corresponding health field.
export function SandboxImageBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  const [orchestratorMissing, setOrchestratorMissing] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    api<ImageHealth>(API.SANDBOX_IMAGES_HEALTH)
      .then((h) => {
        setMissing(h.missing_required ?? []);
        setOrchestratorMissing(h.orchestrator_missing ?? false);
      })
      .catch(() => { /* health unreachable — stay silent rather than false-alarm */ });
  }, []);

  useEffect(() => {
    let active = true;
    refresh();
    const t = setInterval(() => { if (active) refresh(); }, 60000);
    return () => { active = false; clearInterval(t); };
  }, [refresh]);

  if (missing.length === 0 && !orchestratorMissing) return null;

  const rebuildOrchestrator = missing.length === 0 && orchestratorMissing;

  return (
    <>
      <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
        <span>
          {rebuildOrchestrator
            ? <>The hosted orchestrator recovery image is missing — the running service remains available, but its next recreate will fail until rebuilt.</>
            : <>Missing required sandbox image(s): <b>{missing.join(", ")}</b> — sandbox spawning from those templates will fail until rebuilt.</>}
        </span>
        <Button
          size="sm"
          variant="destructive"
          className="ml-auto h-7"
          onClick={() => setOpen(true)}
        >
          <Hammer className="size-3.5" /> {rebuildOrchestrator ? "Rebuild orchestrator now" : `Rebuild ${missing.length === 1 ? missing[0] : "missing images"} now`}
        </Button>
      </div>
      {open && (
        <BuildStreamDialog
          open={open}
          onOpenChange={setOpen}
          url={rebuildOrchestrator ? API.ORCH_BUILD_STREAM : API.SANDBOX_IMAGES_REBUILD_MISSING_STREAM()}
          title={rebuildOrchestrator ? "Rebuilding hosted orchestrator" : `Rebuilding ${missing.join(", ")}`}
          description={rebuildOrchestrator
            ? "Builds the hosted orchestrator image, applies its database migrations, then recreates the service. Running sandboxes are untouched."
            : "Builds missing required sandbox images in dependency order (core → aidream). The aidream build is large — expect several minutes. Sandbox containers in flight are untouched."}
          onComplete={refresh}
        />
      )}
    </>
  );
}
