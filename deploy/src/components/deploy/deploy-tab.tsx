"use client";

import { useState } from "react";
import {
  Rocket, GitBranch, Container, Loader2,
  RotateCcw, ArrowDownToLine, Wrench, Trash2,
  ChevronDown, ChevronRight, MoreHorizontal,
} from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@matrx/admin-ui/ui/collapsible";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@matrx/admin-ui/ui/dropdown-menu";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import type { BuildInfo } from "@/lib/types";

interface DeployTabProps {
  buildInfo: BuildInfo;
  deploying: boolean;
  deployingMgr: boolean;
  rollingBack: string | null;
  onDeploy: (name?: string) => void;
  onRollback: (tag: string) => void;
  onRebuildManager: () => void;
  onCleanup: () => void;
}

export function DeployTab({
  buildInfo,
  deploying,
  deployingMgr,
  rollingBack,
  onDeploy,
  onRollback,
  onRebuildManager,
  onCleanup,
}: DeployTabProps) {
  const [pendingOpen, setPendingOpen] = useState(buildInfo.pending_commits.length <= 5);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  return (
    <PageShell
      title="Deploy"
      description="Build and deploy Docker images to your Matrx Ship instances"
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={() => onDeploy()} disabled={deploying} size="lg">
            {deploying ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            {deploying ? "Building..." : "Deploy All"}
          </Button>
          <Button variant="outline" onClick={onRebuildManager} disabled={deployingMgr}>
            {deployingMgr ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
            Rebuild Manager
          </Button>
          <Button variant="outline" onClick={onCleanup}>
            <Trash2 className="size-4" /> Cleanup
          </Button>
        </div>
      }
    >
      {/* Status overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Current Image</div>
            <div className="text-lg font-mono font-semibold mt-1 truncate">
              {buildInfo.current_image.id || "none"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {buildInfo.current_image.age ? `Built ${buildInfo.current_image.age} ago` : "No image"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Source Branch</div>
            <div className="flex items-center gap-2 mt-1">
              <GitBranch className="size-4 text-primary" />
              <span className="font-mono font-semibold">{buildInfo.source.branch}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
              {buildInfo.source.head_commit}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Pending Changes</div>
            <div className="text-lg font-semibold mt-1">
              {buildInfo.has_changes ? (
                <span className="text-warning">{buildInfo.pending_commits.length} commit(s)</span>
              ) : (
                <span className="text-success">Up to date</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Instances</div>
            <div className="text-lg font-semibold mt-1">{buildInfo.instances.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {buildInfo.instances.filter((i) => i.status === "running").length} running
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instances Table */}
      {buildInfo.instances.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Container className="size-4" /> Instances
            </CardTitle>
            <CardDescription>
              All deployed instances — deploy individually or manage from the table
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buildInfo.instances.map((inst) => (
                  <TableRow key={inst.name}>
                    <TableCell>
                      <div className="font-medium">{inst.display_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{inst.name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={inst.status === "running" ? "success" : "destructive"}
                      >
                        {inst.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
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
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => window.open(`https://${inst.name}.dev.codematrx.com`, "_blank")}
                          >
                            Open Instance
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pending Commits (collapsible) */}
      {buildInfo.pending_commits.length > 0 && (
        <Collapsible open={pendingOpen} onOpenChange={setPendingOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-xl">
                <CardTitle className="text-base flex items-center gap-2">
                  {pendingOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  <GitBranch className="size-4" /> Pending Changes
                  <Badge variant="warning" className="ml-2">
                    {buildInfo.pending_commits.length}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {buildInfo.pending_commits.length} commit(s) since last build ({buildInfo.source.last_build_commit || "never"})
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <div className="space-y-1 font-mono text-sm max-h-48 overflow-y-auto">
                  {buildInfo.pending_commits.map((c, i) => (
                    <div key={i} className="text-muted-foreground py-0.5">{c}</div>
                  ))}
                </div>
                {buildInfo.diff_stats && (
                  <details className="mt-3">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Show diff stats
                    </summary>
                    <pre className="mt-2 p-3 bg-muted rounded-md text-xs overflow-x-auto whitespace-pre-wrap">
                      {buildInfo.diff_stats}
                    </pre>
                  </details>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Available Image Tags / Rollback (collapsible) */}
      {buildInfo.available_tags.length > 1 && (
        <Collapsible open={rollbackOpen} onOpenChange={setRollbackOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-xl">
                <CardTitle className="text-base flex items-center gap-2">
                  {rollbackOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  <RotateCcw className="size-4" /> Available Images & Rollback
                  <Badge variant="secondary" className="ml-2">
                    {buildInfo.available_tags.length}
                  </Badge>
                </CardTitle>
                <CardDescription>Switch to a previous image version</CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tag</TableHead>
                      <TableHead>Image ID</TableHead>
                      <TableHead>Age</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buildInfo.available_tags.map((t) => (
                      <TableRow key={t.tag}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">{t.tag}</span>
                            {t.tag === "latest" && <Badge variant="default" className="text-[10px]">current</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{t.id}</TableCell>
                        <TableCell className="text-muted-foreground">{t.age}</TableCell>
                        <TableCell className="text-right">
                          {t.tag !== "latest" && t.tag !== "<none>" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onRollback(t.tag)}
                              disabled={rollingBack === t.tag}
                            >
                              {rollingBack === t.tag ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <ArrowDownToLine className="size-3" />
                              )}
                              Rollback
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </PageShell>
  );
}
