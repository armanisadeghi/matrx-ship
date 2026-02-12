"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Loader2, ExternalLink, MoreHorizontal, Rocket,
  Play, Square, RotateCcw, Trash2,
} from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { Input } from "@matrx/admin-ui/ui/input";
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
      title="Instances"
      description="Manage ship instances — deploy, configure, and monitor"
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{instances.length} instance(s)</CardTitle>
          <CardDescription>Click an instance name to view details</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {instances.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <p className="text-sm">No instances yet. Create one to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>App Status</TableHead>
                  <TableHead>DB Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((inst) => (
                  <TableRow key={inst.name} className="cursor-pointer" onClick={() => router.push(`/admin/instances/${inst.name}`)}>
                    <TableCell>
                      <div className="font-medium">{inst.display_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{inst.name}</div>
                    </TableCell>
                    <TableCell>
                      <a
                        href={inst.url}
                        target="_blank"
                        rel="noopener"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary text-sm hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="size-3" />
                        {inst.subdomain}
                      </a>
                    </TableCell>
                    <TableCell>
                      <Badge variant={inst.container_status === "running" ? "success" : inst.container_status === "stopped" ? "destructive" : "secondary"}>
                        {inst.container_status || inst.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={inst.db_status === "running" ? "success" : inst.db_status === "stopped" ? "destructive" : "secondary"}>
                        {inst.db_status || "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(inst.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onDeploy(inst.name)} disabled={deploying}>
                            <Rocket className="size-4" /> Deploy
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onInstanceAction(inst.name, "start")}>
                            <Play className="size-4" /> Start
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onInstanceAction(inst.name, "stop")}>
                            <Square className="size-4" /> Stop
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onInstanceAction(inst.name, "restart")}>
                            <RotateCcw className="size-4" /> Restart
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => window.open(inst.url, "_blank")}>
                            <ExternalLink className="size-4" /> Open
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
