"use client";

import { useRouter } from "next/navigation";
import { RotateCw, Square } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import type { SandboxInfo } from "@/lib/types";

interface SandboxesTabProps {
  sandboxes: SandboxInfo[];
  onOpenSandbox: (name: string) => void;
  onSandboxAction: (name: string, action: string) => void;
}

export function SandboxesTab({ sandboxes, onSandboxAction }: SandboxesTabProps) {
  const router = useRouter();

  return (
    <PageShell
      title="Sandbox Environments"
      description={`${sandboxes.length} sandbox(es)`}
    >
      <Card>
        <CardContent className="p-0">
          {sandboxes.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No sandboxes</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">ID</TableHead>
                  <TableHead className="hidden md:table-cell">Image</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sandboxes.map((sbx) => (
                  <TableRow
                    key={sbx.name}
                    className="cursor-pointer"
                    onClick={() => router.push(`/sandboxes/${sbx.name}`)}
                  >
                    <TableCell className="font-medium">{sbx.name}</TableCell>
                    <TableCell>
                      <Badge variant={sbx.status === "running" ? "success" : "destructive"}>{sbx.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground hidden sm:table-cell">{sbx.sandbox_id}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground hidden md:table-cell">{sbx.image}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => onSandboxAction(sbx.name, "restart")}>
                          <RotateCw className="size-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onSandboxAction(sbx.name, "stop")}>
                          <Square className="size-3" />
                        </Button>
                      </div>
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
