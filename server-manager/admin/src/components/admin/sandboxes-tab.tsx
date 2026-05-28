"use client";

import { useRouter } from "next/navigation";
import { RotateCw, Square } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
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
      title="Starter pool"
      description="The static sandbox containers (sandbox-1…5) that predate the orchestrator. Deprecated — being retired in favor of orchestrator-managed Sandboxes."
    >
      <DataTable
        rows={sandboxes}
        getRowKey={(s) => s.name}
        getSearchText={(s) => `${s.name} ${s.sandbox_id} ${s.image} ${s.status}`}
        onRowClick={(s) => router.push(`/sandboxes/${s.name}`)}
        initialSort={{ key: "name", dir: "asc" }}
        searchPlaceholder="Filter…"
        emptyMessage="No starter-pool sandboxes."
        copyView="Starter-pool sandboxes"
        copyDescription="The deprecated static sandbox-1..5 containers."
        getRowData={(s) => ({ name: s.name, sandbox_id: s.sandbox_id, image: s.image, status: s.status })}
        columns={[
          { key: "name", header: "Name", sortValue: (s) => s.name, render: (s) => <span className="font-medium">{s.name}</span> },
          { key: "status", header: "Status", sortValue: (s) => s.status, render: (s) => <Badge variant={s.status === "running" ? "success" : "destructive"}>{s.status}</Badge> },
          { key: "id", header: "ID", hideBelow: "sm", sortValue: (s) => s.sandbox_id || "", render: (s) => <span className="font-mono text-xs text-muted-foreground">{s.sandbox_id}</span> },
          { key: "image", header: "Image", hideBelow: "md", sortValue: (s) => s.image || "", render: (s) => <span className="font-mono text-xs text-muted-foreground">{s.image}</span> },
          {
            key: "actions", header: "", sortable: false, align: "right",
            render: (s) => (
              <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" onClick={() => onSandboxAction(s.name, "restart")}><RotateCw className="size-3" /></Button>
                <Button variant="ghost" size="sm" onClick={() => onSandboxAction(s.name, "stop")}><Square className="size-3" /></Button>
              </div>
            ),
          },
        ] as Column<SandboxInfo>[]}
      />
    </PageShell>
  );
}
