"use client";

import { Loader2 } from "lucide-react";
import { useAdminData } from "@/hooks/use-admin-data";
import { useAdminActions } from "@/hooks/use-admin-actions";
import { useAuth } from "@/lib/auth-context";
import { SystemTab } from "@/components/admin/system-tab";

export default function SystemPage() {
  const { authed } = useAuth();
  const data = useAdminData(authed);
  const actions = useAdminActions({
    loadInstances: data.loadInstances,
    loadSandboxes: data.loadSandboxes,
    loadTokens: data.loadTokens,
    loadBuildInfo: data.loadBuildInfo,
    loadAll: data.loadAll,
  });

  function clearLogs() {
    actions.setBuildLogs([]);
    actions.setBuildPhase(null);
  }

  if (!data.systemInfo) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SystemTab
      systemInfo={data.systemInfo}
      deployingMgr={actions.deployingMgr}
      buildLogs={actions.buildLogs}
      buildPhase={actions.buildPhase}
      deploying={actions.deploying}
      onRebuildManager={actions.handleRebuildManager}
      onClearLogs={clearLogs}
    />
  );
}
