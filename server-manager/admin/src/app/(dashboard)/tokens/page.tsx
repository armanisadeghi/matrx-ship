"use client";

import { useAdminData } from "@/hooks/use-admin-data";
import { useAdminActions } from "@/hooks/use-admin-actions";
import { useAuth } from "@/lib/auth-context";
import { TokensTab } from "@/components/admin/tokens-tab";

export default function TokensPage() {
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
    <TokensTab
      tokens={data.tokens}
      onCreateToken={actions.handleCreateToken}
      onDeleteToken={actions.handleDeleteToken}
    />
  );
}
