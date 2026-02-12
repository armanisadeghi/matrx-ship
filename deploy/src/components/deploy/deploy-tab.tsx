"use client";

import {
  Rocket, GitBranch, Container, Loader2,
  RotateCcw, ArrowDownToLine, Wrench, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/deploy/page-shell";
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
  return (
    <PageShell
      title="Deploy"
      description="Build and deploy Docker images to your Matrx Ship instances"
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

      {/* Pending Commits */}
      {buildInfo.pending_commits.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="size-4" /> Pending Changes
            </CardTitle>
            <CardDescription>
              {buildInfo.pending_commits.length} commit(s) since last build ({buildInfo.source.last_build_commit || "never"})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 font-mono text-sm max-h-48 overflow-y-auto">
              {buildInfo.pending_commits.map((c, i) => (
                <div key={i} className="text-muted-foreground py-0.5">{c}</div>
              ))}
            </div>
            {buildInfo.diff_stats && (
              <pre className="mt-3 p-3 bg-muted rounded-md text-xs overflow-x-auto whitespace-pre-wrap">
                {buildInfo.diff_stats}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Deploy Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="size-4" /> Deploy Actions
          </CardTitle>
          <CardDescription>
            Build a new Docker image from source and redeploy all instances
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => onDeploy()} disabled={deploying} size="lg">
              {deploying ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              {deploying ? "Building..." : "Deploy All Instances"}
            </Button>
            <Button variant="outline" onClick={onRebuildManager} disabled={deployingMgr}>
              {deployingMgr ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
              Rebuild Server Manager
            </Button>
            <Button variant="outline" onClick={onCleanup}>
              <Trash2 className="size-4" /> Cleanup Old Images
            </Button>
          </div>

          {/* Per-instance deploy */}
          {buildInfo.instances.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Deploy Single Instance</h4>
              <div className="flex flex-wrap gap-2">
                {buildInfo.instances.map((inst) => (
                  <Button
                    key={inst.name}
                    variant="secondary"
                    size="sm"
                    onClick={() => onDeploy(inst.name)}
                    disabled={deploying}
                  >
                    <Container className="size-3" /> {inst.display_name}
                    <Badge
                      variant={inst.status === "running" ? "success" : "destructive"}
                      className="ml-1 text-[10px]"
                    >
                      {inst.status}
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Image Tags / Rollback */}
      {buildInfo.available_tags.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RotateCcw className="size-4" /> Available Images & Rollback
            </CardTitle>
            <CardDescription>Switch to a previous image version by clicking rollback</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {buildInfo.available_tags.map((t) => (
                <div
                  key={t.tag}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 px-3 rounded-md bg-muted/50"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-sm font-medium">{t.tag}</span>
                    <span className="text-xs text-muted-foreground font-mono">{t.id}</span>
                    <span className="text-xs text-muted-foreground">{t.age}</span>
                    {t.tag === "latest" && <Badge variant="default" className="text-[10px]">current</Badge>}
                  </div>
                  {t.tag !== "latest" && t.tag !== "<none>" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRollback(t.tag)}
                      disabled={rollingBack === t.tag}
                      className="shrink-0"
                    >
                      {rollingBack === t.tag ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <ArrowDownToLine className="size-3" />
                      )}
                      Rollback
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
