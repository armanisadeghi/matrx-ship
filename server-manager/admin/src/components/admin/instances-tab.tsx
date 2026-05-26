"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Loader2, ExternalLink, MoreHorizontal, Rocket,
  Play, Square, RotateCcw,
} from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Input } from "@matrx/admin-ui/ui/input";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Label } from "@matrx/admin-ui/ui/label";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@matrx/admin-ui/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@matrx/admin-ui/ui/dropdown-menu";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import type { InstanceInfo, BuildInfo } from "@/lib/types";

interface InstancesTabProps {
  instances: InstanceInfo[];
  buildInfo: BuildInfo | null;
  deploying: boolean;
  onDeploy: (name: string) => void;
  onOpenInstance: (name: string) => void;
  onInstanceAction: (name: string, action: string) => void;
  onCreateInstance: (name: string, displayName: string) => Promise<boolean>;
}

export function InstancesTab({
  instances,
  buildInfo,
  deploying,
  onDeploy,
  onInstanceAction,
  onCreateInstance,
}: InstancesTabProps) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    const ok = await onCreateInstance(newName, newDisplay);
    if (ok) {
      setShowCreate(false);
      setNewName("");
      setNewDisplay("");
    }
    setCreating(false);
  }

  return (
    <PageShell
      title="Apps"
      description="Deployed per-project apps (each at its own subdomain with its own database) — deploy, configure, and monitor."
      actions={
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="size-4" /> New Instance</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Instance</DialogTitle>
              <DialogDescription>Set up a new ship instance with its own database and domain.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="name">Instance Name</Label>
                <Input id="name" placeholder="my-app" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="display">Display Name</Label>
                <Input id="display" placeholder="My App" value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating || !newName}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <DataTable
        rows={instances}
        getRowKey={(i) => i.name}
        getSearchText={(i) => `${i.display_name} ${i.name} ${i.subdomain} ${i.container_status || i.status} ${i.db_status || ""}`}
        onRowClick={(i) => router.push(`/instances/${i.name}`)}
        initialSort={{ key: "name", dir: "asc" }}
        searchPlaceholder="Filter instances…"
        emptyMessage="No instances yet. Create one to get started."
        columns={instanceColumns({ deploying, onDeploy, onInstanceAction })}
      />
    </PageShell>
  );
}

function statusVariant(s?: string): "success" | "destructive" | "secondary" {
  return s === "running" ? "success" : s === "stopped" ? "destructive" : "secondary";
}

function instanceColumns({
  deploying, onDeploy, onInstanceAction,
}: {
  deploying: boolean;
  onDeploy: (name: string) => void;
  onInstanceAction: (name: string, action: string) => void;
}): Column<InstanceInfo>[] {
  return [
    {
      key: "name", header: "Name",
      sortValue: (i) => (i.display_name || i.name).toLowerCase(),
      render: (i) => (
        <div>
          <div className="font-medium">{i.display_name}</div>
          <div className="text-xs text-muted-foreground font-mono">{i.name}</div>
        </div>
      ),
    },
    {
      key: "url", header: "URL", sortable: false, hideBelow: "md",
      render: (i) => (
        <a href={i.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
          className="text-primary text-sm hover:underline inline-flex items-center gap-1">
          <ExternalLink className="size-3" /> {i.subdomain}
        </a>
      ),
    },
    {
      key: "app", header: "App",
      sortValue: (i) => i.container_status || i.status || "",
      render: (i) => <Badge variant={statusVariant(i.container_status)}>{i.container_status || i.status}</Badge>,
    },
    {
      key: "db", header: "DB", hideBelow: "sm",
      sortValue: (i) => i.db_status || "",
      render: (i) => <Badge variant={statusVariant(i.db_status)}>{i.db_status || "unknown"}</Badge>,
    },
    {
      key: "created", header: "Created", hideBelow: "lg",
      sortValue: (i) => new Date(i.created_at).getTime() || 0,
      render: (i) => <span className="text-muted-foreground text-sm">{new Date(i.created_at).toLocaleDateString()}</span>,
    },
    {
      key: "actions", header: "", sortable: false, align: "right",
      render: (i) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onDeploy(i.name)} disabled={deploying}><Rocket className="size-4" /> Deploy</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInstanceAction(i.name, "start")}><Play className="size-4" /> Start</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInstanceAction(i.name, "stop")}><Square className="size-4" /> Stop</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInstanceAction(i.name, "restart")}><RotateCcw className="size-4" /> Restart</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.open(i.url, "_blank")}><ExternalLink className="size-4" /> Open</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
}
