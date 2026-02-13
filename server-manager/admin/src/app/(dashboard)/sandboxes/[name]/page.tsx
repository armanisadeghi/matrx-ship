"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAdminData } from "@/hooks/use-admin-data";
import { useAdminActions } from "@/hooks/use-admin-actions";
import { useAuth } from "@/lib/auth-context";
import { SandboxDetail } from "@/components/admin/sandbox-detail";

export default function SandboxDetailPage() {
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
      actions.loadSandboxDetail(name);
    }
  }, [name, authed]);

  const sandbox = data.sandboxes.find((s) => s.name === name);

  if (!sandbox) {
    return <div className="text-muted-foreground py-8">Loading sandbox...</div>;
  }

  return (
    <SandboxDetail
      sandbox={sandbox}
      sandboxDetail={actions.sandboxDetail}
      sandboxLogs={actions.sandboxLogs}
      onBack={() => router.push("/sandboxes")}
      onAction={actions.handleSandboxAction}
      onLoadLogs={actions.handleLoadSandboxLogs}
    />
  );
}
