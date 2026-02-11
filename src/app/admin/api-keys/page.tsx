"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  Plus,
  Copy,
  Check,
  Trash2,
  KeyRound,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ApiKeyData {
  id: string;
  key: string;
  label: string;
  isActive: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    try {
      const res = await fetch("/api/admin/api-keys");
      if (!res.ok) throw new Error("Failed to fetch keys");
      const data = await res.json();
      setKeys(data.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const createKey = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newKeyLabel || "default" }),
      });
      if (!res.ok) throw new Error("Failed to create key");
      const data = await res.json();
      setNewKey(data.key.key);
      setNewKeyLabel("");
      fetchKeys();
    } catch (err) {
      console.error("Create key error:", err);
    } finally {
      setCreating(false);
    }
  };

  const toggleKey = async (id: string, currentActive: number) => {
    try {
      await fetch("/api/admin/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive: currentActive === 1 ? false : true }),
      });
      fetchKeys();
    } catch (err) {
      console.error("Toggle key error:", err);
    }
  };

  const deleteKey = async (id: string) => {
    if (!confirm("Delete this API key? This cannot be undone.")) return;
    try {
      await fetch(`/api/admin/api-keys?id=${id}`, { method: "DELETE" });
      fetchKeys();
    } catch (err) {
      console.error("Delete key error:", err);
    }
  };

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading API keys...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Failed to load</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchKeys}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="API Keys"
      description="Manage API keys for CLI and programmatic access"
      actions={
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Key
        </Button>
      }
    >
      {/* Key List */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {keys.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <KeyRound className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No API keys yet</p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create your first key
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {keys.map((k) => (
              <div key={k.id} className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                    <KeyRound className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">
                        {k.label}
                      </span>
                      <Badge variant={k.isActive === 1 ? "default" : "secondary"}>
                        {k.isActive === 1 ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <code className="text-xs text-muted-foreground font-mono">
                      {k.key}
                    </code>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                      <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                      {k.lastUsedAt && (
                        <span>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => toggleKey(k.id, k.isActive)}
                    title={k.isActive === 1 ? "Deactivate" : "Activate"}
                  >
                    {k.isActive === 1 ? (
                      <ToggleRight className="w-4 h-4 text-success" />
                    ) : (
                      <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteKey(k.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Create a new API key for CLI or programmatic access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="label">Label</Label>
              <Input
                id="label"
                placeholder="e.g., Production CLI"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={createKey} disabled={creating}>
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Key Display Dialog */}
      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy this key now. It will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted rounded-lg px-4 py-3 text-sm font-mono text-foreground break-all">
                {newKey}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => newKey && copyKey(newKey)}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
