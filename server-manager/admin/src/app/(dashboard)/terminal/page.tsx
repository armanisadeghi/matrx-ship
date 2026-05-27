"use client";

import { useEffect, useState, useMemo } from "react";
import { Server, Box, Database, Network, Layers, Boxes, Cpu, Bot, AlertTriangle } from "lucide-react";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API } from "@/lib/api";
import { WebTerminal } from "@/components/web-terminal";

interface Target {
  name: string; image: string; state: string; status: string;
  kind: string; title: string; description?: string; danger?: boolean;
  category: string; categoryLabel: string; order: number;
}

function CatIcon({ category }: { category: string }) {
  const c = "size-3.5";
  switch (category) {
    case "control-plane": return <Cpu className={c} />;
    case "infrastructure": return <Network className={c} />;
    case "sandbox-system": return <Boxes className={c} />;
    case "sandbox": return <Box className={c} />;
    case "app": return <Layers className={c} />;
    case "database": return <Database className={c} />;
    case "agent-env": return <Bot className={c} />;
    default: return <Box className={c} />;
  }
}

function TargetButton({
  active, onClick, title, subtitle, danger,
}: { active: boolean; onClick: () => void; title: string; subtitle: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-md px-2 py-1.5 flex flex-col gap-0.5 transition-colors ${active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted"}`}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
        {title}
        {danger && <AlertTriangle className="size-3 text-amber-500 shrink-0" />}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground leading-tight truncate">{subtitle}</span>
    </button>
  );
}

export default function TerminalPage() {
  const { authed } = useAuth();
  const [containers, setContainers] = useState<Target[]>([]);
  const [ec2, setEc2] = useState<{ id: string; role: string; online: boolean }[]>([]);
  const [target, setTarget] = useState("host");

  useEffect(() => {
    if (!authed) return;
    api<{ containers: Target[] }>(API.CONTAINERS)
      .then((d) => setContainers((d.containers || []).filter((c) => c.state === "running")))
      .catch(() => {});
    api<{ hosts?: { id: string; role: string; online: boolean }[] }>(API.HOSTS)
      .then((d) => setEc2(d.hosts || []))
      .catch(() => {});
  }, [authed]);

  // Group the running containers by category, in canonical order.
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; category: string; order: number; items: Target[] }>();
    for (const c of containers) {
      const g = m.get(c.category) || { label: c.categoryLabel, category: c.category, order: c.order, items: [] };
      g.items.push(c);
      m.set(c.category, g);
    }
    for (const g of m.values()) g.items.sort((a, b) => a.name.localeCompare(b.name));
    return [...m.values()].sort((a, b) => a.order - b.order);
  }, [containers]);

  const selected = target === "host"
    ? { title: "This server (/srv)", danger: true }
    : target.startsWith("ec2:")
      ? { title: `${target.slice(4)} (EC2 via SSM)`, danger: true }
      : containers.find((c) => `container:${c.name}` === target);

  return (
    <PageShell
      title="Terminal"
      description="A live, interactive shell into the server or any container — no SSH. Pick a target on the left, then Connect."
    >
      <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
        {/* Target picker — grouped + labeled so you know what each thing is */}
        <Card className="self-start lg:sticky lg:top-4 max-h-[82vh] overflow-y-auto">
          <CardContent className="p-2 space-y-3">
            <div>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Server className="size-3.5" /> Servers
              </div>
              <TargetButton active={target === "host"} onClick={() => setTarget("host")} title="This server (/srv)" subtitle="the dev host" danger />
              {ec2.map((h) => (
                <TargetButton
                  key={h.id}
                  active={target === `ec2:${h.id}`}
                  onClick={() => setTarget(`ec2:${h.id}`)}
                  title={h.id}
                  subtitle={`EC2 · ${h.online ? "online" : "offline"} (SSM)`}
                  danger
                />
              ))}
            </div>
            {groups.map((g) => (
              <div key={g.category}>
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <CatIcon category={g.category} /> {g.label}
                  <span className="text-muted-foreground/50 font-normal">{g.items.length}</span>
                </div>
                {g.items.map((c) => (
                  <TargetButton
                    key={c.name}
                    active={target === `container:${c.name}`}
                    onClick={() => setTarget(`container:${c.name}`)}
                    title={c.title}
                    subtitle={c.name}
                    danger={c.danger}
                  />
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* The real terminal (xterm over the PTY bridge). Remounts on target change. */}
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {selected?.title || target}
              {selected?.danger && <Badge variant="destructive" className="text-[9px] px-1"><AlertTriangle className="size-2.5 mr-0.5" />infrastructure</Badge>}
            </div>
            <WebTerminal key={target} target={target} heightClass="h-[70vh]" />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
