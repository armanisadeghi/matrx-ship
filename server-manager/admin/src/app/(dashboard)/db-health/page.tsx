"use client";

import { api } from "@/lib/api";
import { DbHealthTab } from "@/components/admin/db-health-tab";

export default function DbHealthPage() {
  return <DbHealthTab api={api} />;
}
