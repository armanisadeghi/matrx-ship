"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, FileText, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@matrx/admin-ui/ui/card";
import { ScrollArea } from "@matrx/admin-ui/ui/scroll-area";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { MarkdownRenderer } from "@matrx/admin-ui/components/markdown-renderer";
import { cn } from "@/lib/utils";

interface DocEntry {
  slug: string;
  title: string;
}

interface DocsTabProps {
  api: <T = Record<string, unknown>>(path: string, opts?: RequestInit) => Promise<T>;
}

export function DocsTab({ api }: DocsTabProps) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const loadDocs = useCallback(async () => {
    try {
      const result = await api<{ docs?: DocEntry[] }>("/api/docs");
      setDocs(result.docs || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  async function loadDoc(slug: string) {
    setLoadingDoc(true);
    setSelectedSlug(slug);
    try {
      const result = await api<{ content?: string }>(`/api/docs?slug=${encodeURIComponent(slug)}`);
      setContent(result.content || "Document not found");
    } catch {
      setContent("Failed to load document");
    } finally {
      setLoadingDoc(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  return (
    <PageShell
      title="Documentation"
      description="Operational guides, runbooks, and reference documentation"
    >
      {docs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <FileText className="size-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No documentation found</h3>
              <p className="text-sm text-muted-foreground">
                Documentation files will appear here once created.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Doc list sidebar */}
          <Card className="lg:sticky lg:top-6 lg:self-start">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contents</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-0.5 p-3">
                  {docs.map((doc) => (
                    <button
                      key={doc.slug}
                      onClick={() => loadDoc(doc.slug)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                        selectedSlug === doc.slug
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <FileText className="size-4 shrink-0" />
                      <span className="flex-1 text-left truncate">{doc.title}</span>
                      <ChevronRight className="size-3 shrink-0" />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Doc content */}
          <Card className="min-h-[60vh]">
            <CardContent className="pt-6">
              {!selectedSlug ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="size-8 mx-auto mb-3 opacity-50" />
                  <p>Select a document from the sidebar</p>
                </div>
              ) : loadingDoc ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="max-h-[75vh]">
                  <MarkdownRenderer content={content} className="pr-4" />
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
