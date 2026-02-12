"use client";

import { useAdminData } from "@/hooks/use-admin-data";
import { useAdminActions } from "@/hooks/use-admin-actions";
import { useAuth } from "@/lib/auth-context";
import { SandboxesTab } from "@/components/admin/sandboxes-tab";

export default function SandboxesPage() {
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
    <SandboxesTab
      sandboxes={data.sandboxes}
      onOpenSandbox={() => {}}
      onSandboxAction={actions.handleSandboxAction}
    />
  );
}
