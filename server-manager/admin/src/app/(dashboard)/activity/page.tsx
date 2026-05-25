"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { RefreshCw, ScrollText, Search, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Input } from "@matrx/admin-ui/ui/input";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface Entry {
  ts: string;
  actor: string;
  action: string;
  target: string;
  details?: Record<string, unknown> | null;
}

// Actions an agent (vs an operator) performs — highlighted so real-infra agent
// activity stands out in the feed.
const AGENT_ACTIONS = new Set([
  "agent_exec", "agent_fs_read", "agent_fs_write", "agent_fs_list", "agent_fs_stat",
  "agent_fs_mkdir", "agent_fs_patch", "agent_search_content", "agent_search_paths", "agent_grant", "agent_revoke",
]);
const DESTRUCTIVE = new Set(["instance_remove", "host_power_stop", "host_power_reboot", "db_restore", "agent_revoke"]);

function actionVariant(action: string): "default" | "secondary" | "destructive" | "success" {
  if (DESTRUCTIVE.has(action)) return "destructive";
  if (AGENT_ACTIONS.has(action)) return "success";
  return "secondary";
}

function Row({ e }: { e: Entry }) {
  const [open, setOpen] = useState(false);
  const hasDetails = e.details && Object.keys(e.details).length > 0;
  const when = useMemo(() => { try { return new Date(e.ts).toLocaleString(); } catch { return e.ts; } }, [e.ts]);
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm ${hasDetails ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"}`}
      >
        <span className="w-4 shrink-0 text-muted-foreground">
          {hasDetails ? (open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />) : null}
        </span>
        <span className="text-xs text-muted-foreground font-mono w-44 shrink-0">{when}</span>
        <Badge variant={actionVariant(e.action)} className="text-[10px] shrink-0">{e.action}</Badge>
        <span className="font-mono text-xs truncate flex-1">{e.target}</span>
        <span className="text-xs text-muted-foreground font-mono shrink-0">{e.actor}</span>
      </button>
      {open && hasDetails && (
        <pre className="mx-3 mb-2 ml-11 rounded bg-zinc-950 text-zinc-300 p-2 font-mono text-[11px] overflow-x-auto">
          {JSON.stringify(e.details, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function ActivityPage() {
  const { authed } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [agentsOnly, setAgentsOnly] = useState(false);

  const load = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    try {
      const data = await api<{ entries: Entry[] }>(API.AUDIT(500));
      setEntries(data.entries || []);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (agentsOnly && !AGENT_ACTIONS.has(e.action)) return false;
      if (!q) return true;
      return (
        e.action.toLowerCase().includes(q) ||
        (e.target || "").toLowerCase().includes(q) ||
        (e.actor || "").toLowerCase().includes(q)
      );
    });
  }, [entries, filter, agentsOnly]);

  return (
    <PageShell
      title="Activity"
      description="Every action taken through the Manager — who did what, to what, and when. Includes operator actions (deploys, power, backups) and everything coding agents do on real infra (commands, file reads/writes). Newest first."
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      }
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-8 text-sm"
            placeholder="filter by action, target, or actor…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <Button variant={agentsOnly ? "default" : "outline"} size="sm" onClick={() => setAgentsOnly((v) => !v)}>
          <ScrollText className="size-4" /> Agent actions only
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-5 text-sm font-mono text-destructive break-all">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {loading && entries.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading activity…</div>
          ) : shown.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {entries.length === 0 ? "No activity recorded yet." : "Nothing matches that filter."}
            </div>
          ) : (
            shown.map((e, i) => <Row key={`${e.ts}-${i}`} e={e} />)
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Showing {shown.length} of {entries.length} most-recent entries.
      </p>
    </PageShell>
  );
}
