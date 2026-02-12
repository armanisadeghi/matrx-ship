"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ServicesTab } from "@/components/deploy/services-tab";
import type { BuildInfo } from "@/lib/types";

export default function InstancesPage() {
  const { api } = useAuth();
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const info = await api("/api/build-info");
      setBuildInfo(info as BuildInfo);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  return <ServicesTab buildInfo={buildInfo} />;
}
