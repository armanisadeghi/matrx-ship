import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * THE relative stamp, owned by `@ai-matrx/kit/format` since 2026-09-12.
 *
 * This repo carried its own ladder — and, like every hand-rolled twin, it was
 * wrong in the ways the package's is not: it read a zone-less Postgres
 * timestamp as LOCAL time (off by the viewer's offset), and it had no future
 * tense at all, so anything ahead of now came out as a negative "-3m ago".
 * Re-exported rather than wrapped: one name, one body, no drift.
 */
export { formatRelativeTime } from "@ai-matrx/kit/format";

/**
 * Generate a random API key
 */
export function generateApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "sk_ship_";
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}
