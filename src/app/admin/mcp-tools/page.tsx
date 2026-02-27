"use client";

import { useState, useEffect } from "react";
import {
  Wrench,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Pencil,
  Power,
  PowerOff,
  Code2,
  Database,
  X,
  Check,
} from "lucide-react";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface McpTool {
  id: string;
  toolName: string;
  description: string;
  inputSchema: string | null;
  sqlTemplate: string;
  targetDatabase: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ToolForm {
  tool_name: string;
  description: string;
  input_schema: string;
  sql_template: string;
  target_database: string;
}

const emptyForm: ToolForm = {
  tool_name: "",
  description: "",
  input_schema: "",
  sql_template: "",
  target_database: "ship",
};

const EXAMPLE_TOOLS: { label: string; form: ToolForm }[] = [
  {
    label: "Count rows",
    form: {
      tool_name: "count_table_rows",
      description: "Get the total row count for a specific table",
      input_schema: JSON.stringify(
        { table_name: { type: "string", description: "Name of the table" } },
        null,
        2,
      ),
      sql_template: 'SELECT COUNT(*)::int AS total FROM "{{table_name}}"',
      target_database: "ship",
    },
  },
  {
    label: "Recent records",
    form: {
      tool_name: "get_recent_records",
      description: "Get the most recently created records from a table",
      input_schema: JSON.stringify(
        {
          table_name: { type: "string", description: "Name of the table" },
          limit: { type: "number", description: "Max rows (default 10)" },
        },
        null,
        2,
      ),
      sql_template:
        'SELECT * FROM "{{table_name}}" ORDER BY created_at DESC LIMIT {{limit}}',
      target_database: "ship",
    },
  },
];

export default function McpToolsPage() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ToolForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTools = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/mcp-tools");
      if (!res.ok) throw new Error("Failed to fetch tools");
      const data = await res.json();
      setTools(data.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (tool: McpTool) => {
    setEditingId(tool.id);
    setForm({
      tool_name: tool.toolName,
      description: tool.description,
      input_schema: tool.inputSchema || "",
      sql_template: tool.sqlTemplate,
      target_database: tool.targetDatabase || "ship",
    });
    setFormError(null);
    setShowForm(true);
  };

  const loadExample = (ex: ToolForm) => {
    setEditingId(null);
    setForm(ex);
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.tool_name || !form.description || !form.sql_template) {
      setFormError("Name, description, and SQL template are required.");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const payload = {
        tool_name: form.tool_name,
        description: form.description,
        input_schema: form.input_schema || null,
        sql_template: form.sql_template,
        target_database: form.target_database || "ship",
      };

      const url = editingId
        ? `/api/admin/mcp-tools/${editingId}`
        : "/api/admin/mcp-tools";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save tool");
      }

      setShowForm(false);
      fetchTools(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (tool: McpTool) => {
    setTogglingId(tool.id);
    try {
      const res = await fetch(`/api/admin/mcp-tools/${tool.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !tool.isActive }),
      });
      if (!res.ok) throw new Error("Failed to toggle tool");
      fetchTools(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (tool: McpTool) => {
    if (
      !confirm(
        `Delete tool "${tool.toolName}"? This cannot be undone.`,
      )
    )
      return;

    setDeletingId(tool.id);
    try {
      const res = await fetch(`/api/admin/mcp-tools/${tool.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete tool");
      fetchTools(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading MCP tools...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Failed to load
          </h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => fetchTools()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Custom MCP Tools"
      description="Create custom AI tools powered by SQL queries. These tools are dynamically available to AI agents via the MCP server."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fetchTools(true)}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")}
            />
            Refresh
          </Button>
          <Button onClick={openNew}>
            <Plus className="w-4 h-4 mr-2" />
            New Tool
          </Button>
        </div>
      }
    >
      {/* How it works */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Code2 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">How it works</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Each custom tool maps to a SQL query template. When an AI agent calls the tool,
          the template parameters get substituted and the query runs against the target database.
          Use <code className="px-1 py-0.5 bg-muted rounded text-[11px]">{"{{param_name}}"}</code> placeholders
          in your SQL template.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Quick start:</span>
          {EXAMPLE_TOOLS.map((ex) => (
            <Button
              key={ex.label}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => loadExample(ex.form)}
            >
              {ex.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <div className="bg-card rounded-xl border border-primary/30 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">
              {editingId ? "Edit Tool" : "New Custom Tool"}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowForm(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Tool Name
                </label>
                <input
                  type="text"
                  value={form.tool_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, tool_name: e.target.value }))
                  }
                  placeholder="my_custom_query"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                  disabled={!!editingId}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Lowercase, underscores only. Cannot be changed later.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Target Database
                </label>
                <input
                  type="text"
                  value={form.target_database}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, target_database: e.target.value }))
                  }
                  placeholder="ship"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Description
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="What does this tool do? (shown to AI agents)"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Input Schema (JSON, optional)
              </label>
              <textarea
                value={form.input_schema}
                onChange={(e) =>
                  setForm((f) => ({ ...f, input_schema: e.target.value }))
                }
                placeholder={'{\n  "table_name": { "type": "string", "description": "Name of the table" }\n}'}
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Define parameters the AI can pass. Each key becomes a{" "}
                <code className="px-1 py-0.5 bg-muted rounded">{"{{key}}"}</code>{" "}
                placeholder.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                SQL Template
              </label>
              <textarea
                value={form.sql_template}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sql_template: e.target.value }))
                }
                placeholder={'SELECT * FROM "{{table_name}}" ORDER BY created_at DESC LIMIT {{limit}}'}
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowForm(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                {editingId ? "Save Changes" : "Create Tool"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tool List */}
      {tools.length === 0 && !showForm ? (
        <div className="text-center py-16 bg-card rounded-xl border border-border">
          <Wrench className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No custom tools yet
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Your instance already has 9 built-in database tools. Create custom
            tools for domain-specific queries.
          </p>
          <Button onClick={openNew}>
            <Plus className="w-4 h-4 mr-2" />
            Create Your First Tool
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className={cn(
                "bg-card rounded-xl border shadow-sm p-5 transition-colors",
                tool.isActive
                  ? "border-border hover:border-primary/20"
                  : "border-border/50 opacity-60",
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center mt-0.5",
                      tool.isActive ? "bg-primary/10" : "bg-muted",
                    )}
                  >
                    <Wrench
                      className={cn(
                        "w-5 h-5",
                        tool.isActive ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold font-mono text-foreground text-sm">
                        {tool.toolName}
                      </h3>
                      <Badge
                        variant={tool.isActive ? "outline" : "secondary"}
                        className="text-[10px]"
                      >
                        {tool.isActive ? "Active" : "Disabled"}
                      </Badge>
                      {tool.targetDatabase && tool.targetDatabase !== "ship" && (
                        <Badge variant="outline" className="text-[10px]">
                          <Database className="w-3 h-3 mr-1" />
                          {tool.targetDatabase}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {tool.description}
                    </p>
                    <pre className="mt-2 px-3 py-2 bg-muted rounded-lg text-xs font-mono text-muted-foreground overflow-x-auto max-w-2xl">
                      {tool.sqlTemplate}
                    </pre>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(tool)}
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => handleToggle(tool)}
                    disabled={togglingId === tool.id}
                    title={tool.isActive ? "Disable" : "Enable"}
                  >
                    {togglingId === tool.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : tool.isActive ? (
                      <PowerOff className="w-4 h-4" />
                    ) : (
                      <Power className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(tool)}
                    disabled={deletingId === tool.id}
                    title="Delete"
                  >
                    {deletingId === tool.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
