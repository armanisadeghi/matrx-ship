"use client";

import { useAdminData } from "@/hooks/use-admin-data";
import { useAdminActions } from "@/hooks/use-admin-actions";
import { useAuth } from "@/lib/auth-context";
import { BuildsTab } from "@/components/admin/builds-tab";

export default function BuildsPage() {
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

  return (
    <BuildsTab
      buildInfo={data.buildInfo}
      buildHistory={data.buildHistory}
      buildLogs={actions.buildLogs}
      buildPhase={actions.buildPhase}
      deploying={actions.deploying}
      deployingMgr={actions.deployingMgr}
      rollingBack={actions.rollingBack}
      onDeploy={() => actions.handleDeploy()}
      onRollback={actions.handleRollback}
      onCleanup={actions.handleCleanup}
      onClearLogs={clearLogs}
    />
  );
}
