"use client";

import { useAdminData } from "@/hooks/use-admin-data";
import { useAdminActions } from "@/hooks/use-admin-actions";
import { useAuth } from "@/lib/auth-context";
import { InstancesTab } from "@/components/admin/instances-tab";

export default function InstancesPage() {
  const { authed } = useAuth();
  const data = useAdminData(authed);
  const actions = useAdminActions({
    loadInstances: data.loadInstances,
    loadSandboxes: data.loadSandboxes,
    loadTokens: data.loadTokens,
    loadBuildInfo: data.loadBuildInfo,
    loadAll: data.loadAll,
  });

  return (
    <InstancesTab
      instances={data.instances}
      buildInfo={data.buildInfo}
      deploying={actions.deploying}
      onDeploy={(name) => actions.handleDeploy(name)}
      onOpenInstance={() => {}}
      onInstanceAction={actions.handleInstanceAction}
      onCreateInstance={actions.handleCreateInstance}
    />
  );
}
