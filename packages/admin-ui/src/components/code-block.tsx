"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "../lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  showLineNumbers?: boolean;
}

export function CodeBlock({ code, language, className, showLineNumbers = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split("\n");

  return (
    <div className={cn("relative group rounded-lg border bg-zinc-950 dark:bg-zinc-900", className)}>
      {/* Header with language label and copy button */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        {language && (
          <span className="text-xs font-mono text-zinc-500 uppercase">{language}</span>
        )}
        {!language && <span />}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {/* Code content */}
      <div className="overflow-x-auto">
        <pre className="p-4 text-sm leading-relaxed">
          <code className="font-mono text-zinc-300">
            {showLineNumbers ? (
              lines.map((line, i) => (
                <div key={i} className="flex">
                  <span className="select-none text-zinc-600 text-right w-8 mr-4 shrink-0">
                    {i + 1}
                  </span>
                  <span className="flex-1">{line}</span>
                </div>
              ))
            ) : (
              code
            )}
          </code>
        </pre>
      </div>
    </div>
  );
}
