import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const DOCS_DIR = "/host-srv/projects/matrx-ship/docs/ops";

function getDocsTree(dir: string, prefix = ""): { slug: string; title: string; path: string }[] {
  if (!existsSync(dir)) return [];

  const entries: { slug: string; title: string; path: string }[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...getDocsTree(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name));
    } else if (entry.name.endsWith(".md")) {
      const slug = prefix
        ? `${prefix}/${basename(entry.name, ".md")}`
        : basename(entry.name, ".md");
      const title = basename(entry.name, ".md")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      entries.push({ slug, title, path: fullPath });
    }
  }
  return entries;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  if (slug) {
    // Return a specific doc
    const docPath = join(DOCS_DIR, `${slug}.md`);
    if (!existsSync(docPath) || !statSync(docPath).isFile()) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const content = readFileSync(docPath, "utf-8");
    return NextResponse.json({ slug, content });
  }

  // Return list of all docs
  const docs = getDocsTree(DOCS_DIR);
  return NextResponse.json({ docs });
}
