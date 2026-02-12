"use client";

import { api } from "@/lib/api";
import { DocsTab } from "@/components/admin/docs-tab";

export default function DocsPage() {
  return <DocsTab api={api} />;
}
