"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { HistoryTab } from "@/components/deploy/history-tab";
import type { BuildRecord } from "@/lib/types";

export default function HistoryPage() {
  const { api } = useAuth();
  const [buildHistory, setBuildHistory] = useState<BuildRecord[]>([]);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const hist = await api("/api/build-history?include_failed=true&limit=50");
      setBuildHistory(((hist as { builds?: BuildRecord[] }).builds) || []);
    } catch { /* handled by auth */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleRollback(tag: string) {
    setRollingBack(tag);
    const toastId = toast.loading(`Rolling back to ${tag}...`);
    try {
      const result = await api("/api/rollback", { method: "POST", body: JSON.stringify({ tag }) });
      const r = result as { success?: boolean; error?: string; instances_restarted?: string[] };
      if (r.success) toast.success(`Rolled back to ${tag}`, { id: toastId });
      else toast.error(`Rollback failed: ${r.error}`, { id: toastId });
      loadData();
    } catch (e) { toast.error(`Rollback failed: ${(e as Error).message}`, { id: toastId }); }
    finally { setRollingBack(null); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  return (
    <HistoryTab
      buildHistory={buildHistory}
      rollingBack={rollingBack}
      onRollback={handleRollback}
    />
  );
}
