"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Container, Loader2, RefreshCw, Play, Square, RotateCcw,
  FileText, Trash2, MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Button } from "@matrx/admin-ui/ui/button";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@matrx/admin-ui/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@matrx/admin-ui/ui/dialog";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";

interface DockerContainer {
  name: string;
  status: string;
  image: string;
  ports: string;
  created: string;
}

export default function DockerPage() {
  const { api } = useAuth();
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsDialog, setLogsDialog] = useState<{ name: string; logs: string } | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadContainers = useCallback(async () => {
    try {
      const result = await api("/api/docker/containers");
      setContainers((result as { containers?: DockerContainer[] }).containers || []);
    } catch { /* handled by auth */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { loadContainers(); }, [loadContainers]);

  async function handleAction(name: string, action: string) {
    const toastId = toast.loading(`${action}ing ${name}...`);
    try {
      await api(`/api/docker/containers/${name}/${action}`, { method: "POST" });
      toast.success(`${action} completed for ${name}`, { id: toastId });
      loadContainers();
    } catch (e) {
      toast.error(`${action} failed: ${(e as Error).message}`, { id: toastId });
    }
  }

  async function viewLogs(name: string) {
    setLoadingLogs(true);
    setLogsDialog({ name, logs: "" });
    try {
      const result = await api(`/api/docker/containers/${name}/logs`);
      setLogsDialog({ name, logs: (result as { logs?: string }).logs || "No logs available" });
    } catch (e) {
      setLogsDialog({ name, logs: `Failed to load logs: ${(e as Error).message}` });
    } finally {
      setLoadingLogs(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  const running = containers.filter((c) => c.status.includes("Up"));
  const stopped = containers.filter((c) => !c.status.includes("Up"));

  return (
    <PageShell
      title="Docker Control"
      description="Emergency Docker container management — start, stop, restart, and view logs for any container"
      actions={
        <Button variant="outline" size="sm" onClick={loadContainers}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-success">{running.length}</p>
            <p className="text-sm text-muted-foreground">Running</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-destructive">{stopped.length}</p>
            <p className="text-sm text-muted-foreground">Stopped / Exited</p>
          </CardContent>
        </Card>
      </div>

      {/* All containers table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Container className="size-4" /> All Containers ({containers.length})
          </CardTitle>
          <CardDescription>Full Docker container management</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {containers.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No containers found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Image</TableHead>
                  <TableHead className="hidden lg:table-cell">Ports</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((c) => {
                  const isRunning = c.status.includes("Up");
                  return (
                    <TableRow key={c.name}>
                      <TableCell>
                        <div className="font-mono text-sm font-medium">{c.name}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={isRunning ? "success" : "destructive"}>
                          {isRunning ? "running" : "stopped"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground hidden md:table-cell max-w-xs truncate">
                        {c.image}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
                        {c.ports || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isRunning ? (
                              <>
                                <DropdownMenuItem onClick={() => handleAction(c.name, "restart")}>
                                  <RotateCcw className="size-4" /> Restart
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleAction(c.name, "stop")}>
                                  <Square className="size-4" /> Stop
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <DropdownMenuItem onClick={() => handleAction(c.name, "start")}>
                                <Play className="size-4" /> Start
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => viewLogs(c.name)}>
                              <FileText className="size-4" /> View Logs
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Logs dialog */}
      <Dialog open={!!logsDialog} onOpenChange={() => setLogsDialog(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Container Logs: {logsDialog?.name}</DialogTitle>
            <DialogDescription>Last 200 lines of container output</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            {loadingLogs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <pre className="bg-zinc-950 text-zinc-300 rounded-lg p-4 font-mono text-xs whitespace-pre-wrap">
                {logsDialog?.logs}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
