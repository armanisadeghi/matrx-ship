"use client";

import { useState } from "react";
import {
  Rocket, Loader2, Trash2, RotateCcw, ArrowDownToLine,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronRight,
} from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { BuildLogViewer } from "@matrx/admin-ui/components/build-log-viewer";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import type { BuildInfo, BuildRecord } from "@/lib/types";

interface BuildsTabProps {
  buildInfo: BuildInfo | null;
  buildHistory: BuildRecord[];
  buildLogs: string[];
  buildPhase: string | null;
  deploying: boolean;
  deployingMgr: boolean;
  rollingBack: string | null;
  onDeploy: () => void;
  onRollback: (tag: string) => void;
  onCleanup: () => void;
  onClearLogs: () => void;
}

export function BuildsTab({
  buildInfo,
  buildHistory,
  buildLogs,
  buildPhase,
  deploying,
  deployingMgr,
  rollingBack,
  onDeploy,
  onRollback,
  onCleanup,
  onClearLogs,
}: BuildsTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <PageShell
      title="Build History"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={onCleanup}>
            <Trash2 className="size-4" /> Cleanup Images
          </Button>
          <Button size="sm" onClick={onDeploy} disabled={deploying}>
            {deploying ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} New Build
          </Button>
        </>
      }
    >
      {/* Pre-build info */}
      {buildInfo && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Current Image</div>
              <div className="font-mono font-semibold mt-1 text-sm truncate">{buildInfo.current_image.id || "none"}</div>
              <div className="text-xs text-muted-foreground mt-1">{buildInfo.current_image.age ? `Built ${buildInfo.current_image.age} ago` : ""}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Pending Changes</div>
              <div className="font-semibold mt-1">
                {buildInfo.has_changes
                  ? <span className="text-warning">{buildInfo.pending_commits.length} commit(s)</span>
                  : <span className="text-success">No changes</span>
                }
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Last Build</div>
              <div className="text-sm mt-1">
                {buildInfo.last_build
                  ? `${buildInfo.last_build.tag} — ${Math.round(buildInfo.last_build.duration_ms / 1000)}s`
                  : "Never"
                }
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Live Build Logs */}
      <BuildLogViewer
        buildLogs={buildLogs}
        buildPhase={buildPhase}
        deploying={deploying}
        deployingMgr={deployingMgr}
        onClear={onClearLogs}
      />

      {/* Build history table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{buildHistory.length} build(s)</CardTitle>
          <CardDescription>Click a row to see build details</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {buildHistory.length === 0 ? (
            <div className="p-6 text-muted-foreground text-sm">No builds recorded yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Commit</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buildHistory.map((b) => {
                  const isExpanded = expandedId === b.id;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="w-8 pr-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : b.id)}
                          className="p-1 hover:bg-muted rounded"
                        >
                          {isExpanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {b.success ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-destructive" />}
                          <Badge variant={b.success ? "success" : "destructive"} className="text-[10px]">{b.success ? "success" : "failed"}</Badge>
                        </div>
                      </TableCell>
                      <TableCell><span className="font-mono text-sm font-medium">{b.tag}</span></TableCell>
                      <TableCell className="text-muted-foreground text-sm">{new Date(b.timestamp).toLocaleDateString()}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{Math.round(b.duration_ms / 1000)}s</TableCell>
                      <TableCell><span className="font-mono text-xs text-muted-foreground">{b.git_commit?.slice(0, 8)}</span></TableCell>
                      <TableCell className="text-right">
                        {b.success && b.tag && !b.tag.startsWith("rollback") && (
                          <Button variant="outline" size="sm" onClick={() => onRollback(b.tag)} disabled={rollingBack === b.tag}>
                            {rollingBack === b.tag ? <Loader2 className="size-3 animate-spin" /> : <ArrowDownToLine className="size-3" />} Rollback
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Expanded build detail */}
      {expandedId && (() => {
        const build = buildHistory.find((b) => b.id === expandedId);
        if (!build) return null;
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Build Details: {build.tag}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {build.git_message && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Commit Message</div>
                  <p className="text-sm">{build.git_message}</p>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Full Commit</div>
                  <div className="font-mono text-xs mt-1">{build.git_commit}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Image ID</div>
                  <div className="font-mono text-xs mt-1">{build.image_id || "N/A"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Instances Restarted</div>
                  <div className="text-xs mt-1">{build.instances_restarted?.join(", ") || "None"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Triggered By</div>
                  <div className="text-xs mt-1">{build.triggered_by}</div>
                </div>
              </div>
              {build.error && (
                <div>
                  <div className="text-xs font-medium text-destructive mb-1">Error</div>
                  <pre className="p-3 bg-destructive/5 border border-destructive/20 rounded-md text-xs text-destructive overflow-x-auto whitespace-pre-wrap">{build.error}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}
    </PageShell>
  );
}
