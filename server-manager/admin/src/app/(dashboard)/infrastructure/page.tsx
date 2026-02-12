"use client";

import { api } from "@/lib/api";
import { useAdminData } from "@/hooks/use-admin-data";
import { useAuth } from "@/lib/auth-context";
import { InfraTab } from "@/components/admin/infra-tab";

export default function InfrastructurePage() {
  const { authed } = useAuth();
  const data = useAdminData(authed);

  return <InfraTab api={api} system={data.systemInfo} />;
}
