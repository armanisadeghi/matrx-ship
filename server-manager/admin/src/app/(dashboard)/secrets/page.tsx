"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  KeySquare, Server, Layers, Eye, EyeOff, Loader2, Check, X, Plus, Pencil, RefreshCw, ShieldAlert, Code,
} from "lucide-react";
import { CopyControls } from "@/components/admin/copy-controls";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Input } from "@matrx/admin-ui/ui/input";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface Store { id: string; label: string; kind: "app" | "infra"; exists: boolean; key_count: number; note: string | null }
interface Entry { key: string; value: string; masked: boolean; length: number }
interface EntriesResp { id: string; label: string; kind: string; note: string | null; exists: boolean; entries: Entry[] }

export default function SecretsPage() {
  const { isSuperadmin } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<EntriesResp | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // inline edit / add
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [devView, setDevView] = useState(false);
  const [devText, setDevText] = useState("");
  const [devSaving, setDevSaving] = useState(false);

  // Vercel-style: pasting/typing "KEY=value" into the key field auto-splits it.
  function onNewKeyChange(v: string) {
    const i = v.indexOf("=");
    if (i > 0) { setNewKey(v.slice(0, i).trim().replace(/^export\s+/, "")); setNewVal(v.slice(i + 1).trim().replace(/^["']|["']$/g, "")); }
    else setNewKey(v);
  }

  const loadStores = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ stores: Store[] }>(API.SECRETS);
      setStores(r.stores || []);
      setSelected((cur) => cur || (r.stores?.[0]?.id ?? null));
      setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  const loadEntries = useCallback(async (id: string, reveal: boolean) => {
    setEntriesLoading(true);
    try { setData(await api<EntriesResp>(API.SECRET_ENTRIES(id, reveal))); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setEntriesLoading(false); }
  }, []);

  useEffect(() => { if (isSuperadmin) loadStores(); }, [isSuperadmin, loadStores]);
  useEffect(() => { if (selected) { setEditKey(null); setAdding(false); loadEntries(selected, revealed); } }, [selected, revealed, loadEntries]);

  async function save(key: string, value: string) {
    if (!selected) return;
    setSaving(true);
    try {
      await api(API.SECRET_ENTRIES(selected), { method: "PUT", body: JSON.stringify({ key, value }) });
      toast.success(`Saved ${key}.${data?.note ? " " + data.note : ""}`);
      setEditKey(null); setAdding(false); setNewKey(""); setNewVal("");
      await loadEntries(selected, revealed);
      await loadStores();
    } catch (e) { toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  }

  // Developer view = the whole store as a .env blob (needs revealed values).
  function openDevView() {
    if (!revealed) { setRevealed(true); toast.info("Revealing values for the developer view."); }
    setDevView(true);
  }
  // Keep the textarea in sync with the (revealed) entries when entering dev view.
  useEffect(() => {
    if (devView) setDevText((data?.entries || []).map((e) => `${e.key}=${e.value}`).join("\n"));
  }, [devView, data]);

  async function saveDev() {
    if (!selected) return;
    setDevSaving(true);
    try {
      const r = await api<{ applied: string[]; skipped: string[] }>(API.SECRET_BULK(selected), { method: "PUT", body: JSON.stringify({ text: devText }) });
      toast.success(`Applied ${r.applied.length} key(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ""}.${data?.note ? " " + data.note : ""}`);
      setDevView(false);
      await loadEntries(selected, revealed);
      await loadStores();
    } catch (e) { toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setDevSaving(false); }
  }

  const envText = (data?.entries || []).map((e) => `${e.key}=${e.value}`).join("\n");

  if (!isSuperadmin) return null; // layout shows the super-admin gate

  const shown = (data?.entries || []).filter((e) => !filter || e.key.toLowerCase().includes(filter.toLowerCase()));

  return (
    <PageShell
      title="Secrets"
      description="View and set the environment values across the system — each app's .env plus the Server Manager and orchestrator config. This is separate from Access Tokens (which are API keys for calling the Manager)."
      actions={<Button variant="outline" size="sm" onClick={loadStores} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>}
    >
      {error && <Card className="border-destructive/40"><CardContent className="pt-5 text-sm font-mono text-destructive break-all">{error}</CardContent></Card>}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* Store list */}
        <Card className="self-start">
          <CardContent className="p-2 space-y-3">
            {(["infra", "app"] as const).map((kind) => {
              const list = stores.filter((s) => s.kind === kind);
              if (!list.length) return null;
              return (
                <div key={kind}>
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    {kind === "infra" ? <Server className="size-3.5" /> : <Layers className="size-3.5" />}
                    {kind === "infra" ? "Infrastructure" : "App deployments"}
                  </div>
                  {list.map((s) => (
                    <button key={s.id} type="button" onClick={() => setSelected(s.id)}
                      className={`w-full text-left rounded-md px-2 py-1.5 flex items-center justify-between gap-2 ${selected === s.id ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted"}`}>
                      <span className="text-sm truncate">{s.label}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{s.key_count}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Entries */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <KeySquare className="size-4 text-muted-foreground" />
              <span className="font-semibold">{data?.label || "…"}</span>
              {data && <Badge variant="secondary" className="text-[10px]">{data.entries.length} keys</Badge>}
              {revealed && data?.exists && <CopyControls plain={envText} />}
              <div className="flex-1" />
              <Button size="sm" variant={devView ? "default" : "outline"} onClick={() => (devView ? setDevView(false) : openDevView())}>
                <Code className="size-4" /> Developer view
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRevealed((v) => !v)}>
                {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {revealed ? "Hide" : "Reveal"} values
              </Button>
              <Button size="sm" onClick={() => { setAdding(true); setEditKey(null); }}><Plus className="size-4" /> Add</Button>
            </div>

            {data?.note && (
              <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded px-3 py-1.5 flex items-center gap-1.5">
                <ShieldAlert className="size-3.5 shrink-0" /> {data.note}
              </div>
            )}

            <div className="relative max-w-xs">
              <Input className="h-8 text-sm" placeholder="Filter keys…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>

            {adding && (
              <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                <Input className="h-8 text-xs font-mono w-48" placeholder="NEW_KEY (or paste KEY=value)" value={newKey} onChange={(e) => onNewKeyChange(e.target.value)} />
                <Input className="h-8 text-xs font-mono flex-1" placeholder="value" value={newVal} onChange={(e) => setNewVal(e.target.value)} />
                <Button size="sm" disabled={saving || !newKey.trim()} onClick={() => save(newKey.trim(), newVal)}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewKey(""); setNewVal(""); }}><X className="size-4" /></Button>
              </div>
            )}

            {devView ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Edit as a raw <span className="font-mono">.env</span>. Saving <strong>upserts</strong> every <span className="font-mono">KEY=value</span> line; lines you remove here are <strong>not</strong> deleted (safety). {data?.note}
                </p>
                <textarea
                  className="w-full h-[55vh] rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed"
                  value={devText}
                  onChange={(e) => setDevText(e.target.value)}
                  spellCheck={false}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={devSaving} onClick={saveDev}>{devSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save .env</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDevView(false)}>Cancel</Button>
                  <CopyControls plain={devText} />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border divide-y">
                {entriesLoading ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
                ) : shown.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">{data?.exists === false ? "No .env file for this store yet — Add a key to create it." : "No keys match."}</div>
                ) : shown.map((e) => (
                  <div key={e.key} className="flex items-center gap-3 px-3 py-1.5 text-sm group">
                    <span className="font-mono text-xs w-56 shrink-0 truncate" title={e.key}>{e.key}</span>
                    {editKey === e.key ? (
                      <>
                        <Input className="h-8 text-xs font-mono flex-1" value={editVal} onChange={(ev) => setEditVal(ev.target.value)} autoFocus />
                        <Button size="sm" disabled={saving} onClick={() => save(e.key, editVal)}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditKey(null)}><X className="size-4" /></Button>
                      </>
                    ) : (
                      <>
                        <span className={`flex-1 truncate ${e.masked ? "text-muted-foreground" : "font-mono text-xs"}`}>{e.value}</span>
                        {!e.masked && <CopyControls plain={e.value} />}
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditKey(e.key); setEditVal(e.masked ? "" : e.value); if (e.masked) toast.info("Reveal values to edit in place, or type a new value to overwrite."); }}>
                          <Pencil className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
