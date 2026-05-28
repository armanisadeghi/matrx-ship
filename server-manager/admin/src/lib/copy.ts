import { toast } from "sonner";

// Shared clipboard helpers. Two modes everywhere:
//   • plain   — the raw value/text, for humans.
//   • for AI  — the same data wrapped in a small XML-ish envelope with context
//               (where it's from + what it is + guidance) so you can paste it
//               straight into an agent and it knows what it's looking at.

export interface AiBlock {
  /** Where this came from, e.g. "Apps", "Versions & Updates". */
  view: string;
  /** One line on what this data is. */
  description?: string;
  /** Extra instruction for the agent on how to read/use it. */
  guidance?: string;
  /** The payload — object/array (JSON-encoded) or a pre-formatted string. */
  data: unknown;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function aiBlock(b: AiBlock): string {
  const data = typeof b.data === "string" ? b.data : JSON.stringify(b.data, null, 2);
  const parts = [
    `<matrx-context source="Matrx Server Manager" view="${esc(b.view)}">`,
    `  <about>The Matrx Server Manager is the control plane at manager.dev.codematrx.com that manages the /srv host, its EC2 boxes, app deployments, sandboxes, and infrastructure.</about>`,
    b.description ? `  <description>${esc(b.description)}</description>` : null,
    b.guidance ? `  <guidance>${esc(b.guidance)}</guidance>` : null,
    `  <data format="${typeof b.data === "string" ? "text" : "json"}">`,
    data,
    `  </data>`,
    `</matrx-context>`,
  ].filter(Boolean);
  return parts.join("\n");
}

async function write(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

export async function copyText(text: string) {
  if (await write(text)) toast.success("Copied"); else toast.error("Copy failed");
}
export async function copyForAI(b: AiBlock) {
  if (await write(aiBlock(b))) toast.success("Copied for AI (with context)"); else toast.error("Copy failed");
}
