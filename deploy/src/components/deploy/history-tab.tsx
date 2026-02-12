"use client";

import {
  History, Clock, CheckCircle2, AlertTriangle,
  ArrowDownToLine, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/deploy/page-shell";
import type { BuildRecord } from "@/lib/types";

interface HistoryTabProps {
  buildHistory: BuildRecord[];
  rollingBack: string | null;
  onRollback: (tag: string) => void;
}

export function HistoryTab({ buildHistory, rollingBack, onRollback }: HistoryTabProps) {
  return (
    <PageShell
      title="Build History"
      description="View past builds, their status, and roll back to any successful build"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="size-4" /> All Builds
          </CardTitle>
          <CardDescription>{buildHistory.length} build(s) recorded</CardDescription>
        </CardHeader>
        <CardContent>
          {buildHistory.length === 0 ? (
            <p className="text-muted-foreground text-sm">No builds recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {buildHistory.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3 rounded-lg border bg-card"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {b.success ? (
                        <CheckCircle2 className="size-4 text-success shrink-0" />
                      ) : (
                        <AlertTriangle className="size-4 text-destructive shrink-0" />
                      )}
                      <span className="font-mono text-sm font-medium">{b.tag}</span>
                      <Badge
                        variant={b.success ? "success" : "destructive"}
                        className="text-[10px]"
                      >
                        {b.success ? "success" : "failed"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {new Date(b.timestamp).toLocaleString()}
                      </span>
                      <span>{Math.round(b.duration_ms / 1000)}s</span>
                      <span className="font-mono">{b.git_commit}</span>
                      <span>by {b.triggered_by}</span>
                    </div>
                    {b.git_message && (
                      <div className="text-xs text-muted-foreground truncate">{b.git_message}</div>
                    )}
                    {b.error && (
                      <div className="text-xs text-destructive mt-1">{b.error}</div>
                    )}
                  </div>
                  {b.success && b.tag && !b.tag.startsWith("rollback") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRollback(b.tag)}
                      disabled={rollingBack === b.tag}
                      className="shrink-0"
                    >
                      {rollingBack === b.tag ? (
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
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
