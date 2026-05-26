"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Server, Cloud, Cpu, HardDrive, MemoryStick, CheckCircle2, XCircle,
  RefreshCw, TerminalSquare, Boxes, ChevronRight,
} from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface SystemInfo {
  hostname: string; cpus: number; uptime_hours: string;
  memory: { total: string; used: string; percent: string };
  disk: { total: string; used: string; percent: string };
  containers: string[];
}
interface Ec2Host {
  id: string; role: string; instanceId: string; region: string; online: boolean;
  ssm: { platform?: string; platformVersion?: string } | null;
  ec2: { state?: string; type?: string; az?: string; privateIp?: string; publicIp?: string } | null;
}
interface HostsResp { aws_configured?: boolean; hosts?: Ec2Host[]; error?: string }

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="leading-tight">
        <div className="text-sm font-medium">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export default function ServersPage() {
  const { authed, isSuperadmin } = useAuth();
  const router = useRouter();
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [ec2, setEc2] = useState<Ec2Host[] | null>(null);
  const [ec2Note, setEc2Note] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSys(await api<SystemInfo>(API.SYSTEM)); } catch { /* */ }
    try {
      const h = await api<HostsResp>(API.HOSTS);
      setEc2(h.hosts || []);
      setEc2Note(h.aws_configured === false ? "AWS not configured on the Manager." : null);
    } catch (e) {
      setEc2([]);
      setEc2Note(e instanceof ApiError && e.status === 403 ? "EC2 details are super-admin only." : "Couldn't load EC2 boxes.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  return (
    <PageShell
      title="Servers"
      description="The physical machines we run on. Everything else (apps, sandboxes, databases, services) runs on top of these. Start here, then drill down."
      actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>}
    >
      {/* This server (/srv) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            This server <span className="font-mono text-sm text-muted-foreground">/srv</span>
            <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3 mr-1" />online</Badge>
            <Badge variant="secondary" className="text-[10px]">Hostinger · the dev host</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Runs the control plane, every app deployment + its database, the sandbox orchestrator, and shared infrastructure. This is what the Server Manager manages directly.
          </p>
          {sys && (
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <Stat icon={<Cpu className="size-4" />} label="CPUs" value={String(sys.cpus)} />
              <Stat icon={<MemoryStick className="size-4" />} label={`memory (${sys.memory?.used}/${sys.memory?.total})`} value={sys.memory?.percent || "?"} />
              <Stat icon={<HardDrive className="size-4" />} label={`disk (${sys.disk?.used}/${sys.disk?.total})`} value={sys.disk?.percent || "?"} />
              <Stat icon={<Boxes className="size-4" />} label="containers" value={String(sys.containers?.length ?? "?")} />
              <Stat icon={<RefreshCw className="size-4" />} label="uptime (hrs)" value={sys.uptime_hours || "?"} />
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => router.push("/system")}>System detail <ChevronRight className="size-3.5" /></Button>
            {isSuperadmin && <Button size="sm" variant="outline" onClick={() => router.push("/terminal")}><TerminalSquare className="size-4" /> Open terminal</Button>}
          </div>
        </CardContent>
      </Card>

      {/* EC2 boxes */}
      <div className="flex items-center gap-2 pt-2">
        <Cloud className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">AWS EC2 boxes</h2>
        <span className="text-xs text-muted-foreground">us-east-1 · acct 872515272894</span>
      </div>

      {ec2Note && (
        <Card className="border-amber-500/30 bg-amber-500/5"><CardContent className="pt-4 text-sm text-muted-foreground">{ec2Note}</CardContent></Card>
      )}

      {ec2?.map((h) => (
        <Card key={h.id} className={h.online ? "" : "border-amber-500/40"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Cloud className="size-4 text-muted-foreground" />
              <span>{h.id}</span>
              {h.online
                ? <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3 mr-1" />online</Badge>
                : <Badge variant="destructive" className="text-[10px]"><XCircle className="size-3 mr-1" />offline</Badge>}
              {h.ec2?.state && <Badge variant="secondary" className="text-[10px]">{h.ec2.state}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">{h.role}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground font-mono">
              <span>{h.instanceId}</span>
              {h.ec2?.type && <span>{h.ec2.type}</span>}
              {h.ec2?.publicIp && <span>pub {h.ec2.publicIp}</span>}
              {h.ec2?.privateIp && <span>priv {h.ec2.privateIp}</span>}
              {h.ssm?.platform && <span>{h.ssm.platform} {h.ssm.platformVersion}</span>}
            </div>
            {isSuperadmin && (
              <div className="pt-1">
                <Button size="sm" variant="outline" onClick={() => router.push("/hosts")}>Manage (command / power) <ChevronRight className="size-3.5" /></Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {!loading && (!ec2 || ec2.length === 0) && !ec2Note && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No EC2 boxes registered.</CardContent></Card>
      )}
    </PageShell>
  );
}
