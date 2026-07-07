"use client";

/**
 * Files — browse, view, and edit files on the /srv host and the EC2 fleet
 * boxes without SSH or the terminal. Superadmin. Writes always keep a
 * .bak-<epoch> copy on the target machine.
 *
 * Local target sees /srv and /data (what the Manager container mounts).
 * EC2 targets go over SSM: listing is fast; file view is chunked (192KB cap)
 * and edits cap at 64KB — plenty for configs, and the API says so plainly
 * when a file is bigger.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Folder, FileText, Link2, RefreshCw, Loader2, Save, X, Pencil, ChevronRight, HardDrive, Cloud, ShieldAlert, FileWarning,
} from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface Target { id: string; label: string; kind: "local" | "ec2"; roots: string[] }
interface Entry { name: string; type: "dir" | "file" | "link" | "unknown"; size: number | null; mtime: number | null }
interface ReadResp { path: string; size: number; is_binary: boolean; content: string | null }

function fmtSize(n: number | null) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { isSuperadmin } = useAuth();
  const [targets, setTargets] = useState<Target[]>([]);
  const [target, setTarget] = useState<string>("local");
  const [path, setPath] = useState<string>("/srv");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<ReadResp | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ targets: Target[] }>(API.FILES_TARGETS)
      .then((r) => setTargets(r.targets || []))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const list = useCallback(async (t: string, p: string) => {
    setListing(true);
    setFile(null);
    setEditing(false);
    try {
      const r = await api<{ entries: Entry[] }>(`${API.FILES_LIST}?target=${encodeURIComponent(t)}&path=${encodeURIComponent(p)}`);
      setEntries(r.entries || []);
      setError(null);
    } catch (e) {
      setEntries([]);
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setListing(false);
    }
  }, []);

  useEffect(() => { void list(target, path); }, [target, path, list]);

  function switchTarget(id: string) {
    const t = targets.find((x) => x.id === id);
    setTarget(id);
    setPath(t?.roots?.[0] || "/");
  }

  async function openFile(p: string) {
    setFileLoading(true);
    setEditing(false);
    try {
      const r = await api<ReadResp>(`${API.FILES_READ}?target=${encodeURIComponent(target)}&path=${encodeURIComponent(p)}`);
      setFile(r);
      setDraft(r.content ?? "");
      setError(null);
    } catch (e) {
      setFile(null);
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setFileLoading(false);
    }
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      await api(API.FILES_WRITE, { method: "PUT", body: JSON.stringify({ target, path: file.path, content: draft }) });
      toast.success(`Saved ${file.path} (previous version kept as .bak)`);
      setFile({ ...file, content: draft, size: draft.length });
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const crumbs = path.split("/").filter(Boolean);

  if (!isSuperadmin) {
    return (
      <PageShell title="Files" description="Browse and edit files across the fleet.">
        <Card><CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="size-4" /> Superadmin only.
        </CardContent></Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Files"
      description="Browse, view, and edit files on the /srv host and the EC2 boxes — no SSH, no terminal. Every save keeps a .bak copy on the machine."
      actions={
        <Button variant="outline" size="sm" onClick={() => list(target, path)} disabled={listing}>
          {listing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* Target list */}
        <Card className="self-start">
          <CardContent className="p-2">
            {targets.map((t) => (
              <button key={t.id} type="button" onClick={() => switchTarget(t.id)}
                className={`w-full text-left rounded-md px-2 py-1.5 flex items-center gap-2 ${target === t.id ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted"}`}>
                {t.kind === "local" ? <HardDrive className="size-4 shrink-0" /> : <Cloud className="size-4 shrink-0" />}
                <span className="text-sm truncate">{t.label}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Browser + viewer */}
        <div className="space-y-3 min-w-0">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-sm flex-wrap">
            <button type="button" className="text-primary hover:underline" onClick={() => setPath(targets.find((t) => t.id === target)?.roots?.[0] || "/")}>
              {target === "local" ? "host" : target.replace(/^ec2:/, "")}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <button type="button" className="text-primary hover:underline" onClick={() => setPath("/" + crumbs.slice(0, i + 1).join("/"))}>{c}</button>
              </span>
            ))}
          </div>

          {error && (
            <Card><CardContent className="p-3 text-sm text-destructive flex items-center gap-2"><FileWarning className="size-4" />{error}</CardContent></Card>
          )}

          <Card>
            <CardContent className="p-0">
              {listing ? (
                <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Listing {path}…</div>
              ) : (
                <div className="divide-y">
                  {entries.length === 0 && !error && (
                    <div className="p-4 text-sm text-muted-foreground">Empty directory.</div>
                  )}
                  {entries.map((e) => {
                    const full = `${path === "/" ? "" : path}/${e.name}`;
                    return (
                      <button key={e.name} type="button"
                        onClick={() => (e.type === "dir" ? setPath(full) : openFile(full))}
                        className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-muted">
                        {e.type === "dir" ? <Folder className="size-4 text-blue-500 shrink-0" /> : e.type === "link" ? <Link2 className="size-4 text-muted-foreground shrink-0" /> : <FileText className="size-4 text-muted-foreground shrink-0" />}
                        <span className="text-sm truncate flex-1">{e.name}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{fmtSize(e.size)}</span>
                        {e.mtime ? <span className="text-[11px] text-muted-foreground tabular-nums hidden md:inline">{new Date(e.mtime).toLocaleString()}</span> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* File viewer / editor */}
          {(fileLoading || file) && (
            <Card>
              <CardContent className="p-3 space-y-2">
                {fileLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading file…</div>
                ) : file ? (
                  <>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="size-4 shrink-0" />
                        <span className="text-sm font-mono truncate">{file.path}</span>
                        <Badge variant="secondary">{fmtSize(file.size)}</Badge>
                        {file.is_binary && <Badge variant="destructive">binary — view/edit not supported</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        {!file.is_binary && !editing && (
                          <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
                        )}
                        {editing && (
                          <>
                            <Button size="sm" onClick={save} disabled={saving}>
                              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft(file.content ?? ""); }}><X className="size-4" /> Cancel</Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setFile(null)}><X className="size-4" /></Button>
                      </div>
                    </div>
                    {!file.is_binary && (
                      editing ? (
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          spellCheck={false}
                          className="w-full min-h-[360px] rounded-md border bg-background p-3 font-mono text-xs leading-5"
                        />
                      ) : (
                        <pre className="w-full max-h-[480px] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{file.content}</pre>
                      )
                    )}
                  </>
                ) : null}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}
