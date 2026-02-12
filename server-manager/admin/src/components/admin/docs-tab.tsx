"use client";

import { useState, useEffect } from "react";
import { FileText, ChevronRight, Loader2, Book, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageShell } from "@/components/admin/page-shell";

interface DocEntry {
  slug: string;
  title: string;
}

interface Props {
  api: (path: string, opts?: RequestInit) => Promise<unknown>;
}

export function DocsTab({ api }: Props) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);

  async function loadDocs() {
    setLoading(true);
    try {
      const result = (await api("/api/docs")) as { docs?: DocEntry[] };
      setDocs(result.docs || []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadDoc(slug: string) {
    setLoadingDoc(true);
    setSelectedSlug(slug);
    try {
      const result = (await api(`/api/docs?slug=${encodeURIComponent(slug)}`)) as {
        content?: string;
      };
      setContent(result.content || "");
    } catch {
      setContent("Failed to load document");
    } finally {
      setLoadingDoc(false);
    }
  }

  useEffect(() => {
    loadDocs();
  }, []);

  return (
    <PageShell
      title="Documentation"
      description="Operational guides, runbooks, and reference documentation"
      icon={Book}
      actions={
        <Button variant="outline" size="sm" onClick={loadDocs} disabled={loading}>
          <RefreshCw className="size-4" />
          <span className="ml-2">Refresh</span>
        </Button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : docs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <FileText className="size-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No documentation found</h3>
              <p className="text-sm text-muted-foreground">
                Create markdown files in{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  /srv/projects/matrx-ship/docs/ops/
                </code>{" "}
                to see them here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
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
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed">{content}</pre>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
