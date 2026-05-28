"use client";

import { useState } from "react";
import { Plus, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Input } from "@matrx/admin-ui/ui/input";
import { Label } from "@matrx/admin-ui/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@matrx/admin-ui/ui/select";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@matrx/admin-ui/ui/dialog";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import type { TokenInfo } from "@/lib/types";

interface TokensTabProps {
  tokens: TokenInfo[];
  onCreateToken: (label: string, role: string) => Promise<string | null>;
  onDeleteToken: (id: string) => void;
}

export function TokensTab({ tokens, onCreateToken, onDeleteToken }: TokensTabProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newRole, setNewRole] = useState("viewer");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  async function handleCreate() {
    const token = await onCreateToken(newLabel, newRole);
    if (token) {
      setCreatedToken(token);
      setShowCreate(false);
      setNewLabel("");
      setNewRole("viewer");
    }
  }

  return (
    <PageShell
      title="Access Tokens"
      actions={
        <Button size="sm" onClick={() => { setShowCreate(true); setCreatedToken(null); setNewLabel(""); setNewRole("viewer"); }}>
          <Plus className="size-4" /> Create Token
        </Button>
      }
    >
      {createdToken && (
        <Card className="border-success/50 bg-success/5">
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm font-medium text-success">New token created — copy it now!</p>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-3 py-1.5 rounded text-sm font-mono flex-1 break-all">{createdToken}</code>
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(createdToken); toast.success("Copied!"); }}>
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">This token will not be shown again.</p>
          </CardContent>
        </Card>
      )}

      <DataTable
        rows={tokens}
        getRowKey={(t) => t.id}
        getSearchText={(t) => `${t.label} ${t.role} ${t.id}`}
        initialSort={{ key: "label", dir: "asc" }}
        searchPlaceholder="Filter tokens…"
        emptyMessage="No tokens yet."
        copyView="Access Tokens"
        copyDescription="Manager API tokens (the secret values are never stored — only hashes)."
        getRowData={(t) => ({ id: t.id, label: t.label, role: t.role, created_at: t.created_at, last_used_at: t.last_used_at })}
        columns={[
          { key: "label", header: "Label", sortValue: (t) => t.label, render: (t) => <span className="font-medium">{t.label}</span> },
          { key: "role", header: "Role", sortValue: (t) => t.role, render: (t) => <Badge variant={t.role === "admin" ? "default" : "secondary"}>{t.role}</Badge> },
          { key: "id", header: "ID", hideBelow: "sm", sortValue: (t) => t.id, render: (t) => <span className="font-mono text-xs text-muted-foreground">{t.id}</span> },
          { key: "created", header: "Created", hideBelow: "md", sortValue: (t) => new Date(t.created_at).getTime() || 0, render: (t) => <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</span> },
          { key: "used", header: "Last used", hideBelow: "md", sortValue: (t) => (t.last_used_at ? new Date(t.last_used_at).getTime() : 0), render: (t) => <span className="text-xs text-muted-foreground">{t.last_used_at ? new Date(t.last_used_at).toLocaleDateString() : "Never"}</span> },
          { key: "actions", header: "", sortable: false, align: "right", render: (t) => <Button variant="ghost" size="sm" onClick={() => onDeleteToken(t.id)}><Trash2 className="size-3" /></Button> },
        ] as Column<TokenInfo>[]}
      />

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Access Token</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="My token" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="deployer">Deployer</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
