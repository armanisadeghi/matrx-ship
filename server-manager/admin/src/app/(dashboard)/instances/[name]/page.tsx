"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useAdminData } from "@/hooks/use-admin-data";
import { useAdminActions } from "@/hooks/use-admin-actions";
import { useAuth } from "@/lib/auth-context";
import { InstanceDetail } from "@/components/admin/instance-detail";

export default function InstanceDetailPage() {
  const { authed } = useAuth();
  const router = useRouter();
  const params = useParams();
  const name = params.name as string;

  const data = useAdminData(authed);
  const actions = useAdminActions({
    loadInstances: data.loadInstances,
    loadSandboxes: data.loadSandboxes,
    loadTokens: data.loadTokens,
    loadBuildInfo: data.loadBuildInfo,
    loadAll: data.loadAll,
  });

  useEffect(() => {
    if (name && authed) {
      actions.loadInstanceDetail(name);
    }
  }, [name, authed]);

  const instance = data.instances.find((i) => i.name === name);

  if (!instance) {
    return <div className="text-muted-foreground py-8">Loading instance...</div>;
  }

  return (
    <InstanceDetail
      instance={instance}
      instanceDetail={actions.instanceDetail}
      instanceLogs={actions.instanceLogs}
      instanceEnv={actions.instanceEnv}
      instanceCompose={actions.instanceCompose}
      instanceBackups={actions.instanceBackups}
      deploying={actions.deploying}
      onBack={() => router.push("/instances")}
      onDeploy={(n) => actions.handleDeploy(n)}
      onAction={actions.handleInstanceAction}
      onRemove={actions.handleRemoveInstance}
      onLoadLogs={actions.handleLoadLogs}
      onSaveEnv={actions.handleSaveEnv}
      onCreateBackup={actions.handleCreateBackup}
      onLoadDetail={actions.loadInstanceDetail}
    />
  );
}
