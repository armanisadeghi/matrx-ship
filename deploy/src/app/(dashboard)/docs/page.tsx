"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, FileText, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/lib/auth-context";

interface DocEntry {
  slug: string;
  title: string;
}

export default function DocsPage() {
  const { api } = useAuth();
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const loadDocs = useCallback(async () => {
    try {
      const result = await api("/api/docs");
      setDocs((result as { docs?: DocEntry[] }).docs || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  async function loadDoc(slug: string) {
    setLoadingDoc(true);
    setSelectedSlug(slug);
    try {
      const result = await api(`/api/docs?slug=${encodeURIComponent(slug)}`);
      setContent((result as { content?: string }).content || "Document not found");
    } catch {
      setContent("Failed to load document");
    } finally {
      setLoadingDoc(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documentation</h1>
        <p className="text-muted-foreground">Operational guides, runbooks, and reference documentation</p>
      </div>

      {docs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <FileText className="size-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No documentation found</h3>
              <p className="text-sm text-muted-foreground">
                Documentation files will appear here once created at{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  /srv/projects/matrx-ship/docs/ops/
                </code>
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
                      className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedSlug === doc.slug
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
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
          <Card>
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
                <ScrollArea className="max-h-[80vh]">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed">{content}</pre>
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
