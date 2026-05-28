"use client";

import { Copy, Sparkles } from "lucide-react";
import { copyText, copyForAI, type AiBlock } from "@/lib/copy";

// A compact pair of copy buttons to drop onto any card / row / table:
//   • plain copy (clipboard icon)
//   • copy for AI (sparkles) — wraps the data with source + context + guidance
// Pass `plain` (a string) and/or `ai` (an AiBlock). Renders only what's given.
export function CopyControls({
  plain, ai, size = 14, className = "",
}: {
  plain?: string;
  ai?: AiBlock;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      {plain != null && (
        <button
          type="button"
          onClick={() => copyText(plain)}
          title="Copy"
          className="rounded p-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
        >
          <Copy style={{ width: size, height: size }} />
        </button>
      )}
      {ai && (
        <button
          type="button"
          onClick={() => copyForAI(ai)}
          title="Copy for AI — structured data + context, ready to paste into an agent"
          className="rounded p-1 text-muted-foreground/60 hover:text-primary hover:bg-muted transition-colors"
        >
          <Sparkles style={{ width: size, height: size }} />
        </button>
      )}
    </span>
  );
}
