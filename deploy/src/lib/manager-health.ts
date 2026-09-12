export type ManagerHealthStatus = "running" | "down" | "unknown";

export type CommandResult = {
  success: boolean;
  output: string;
  error?: string;
};

/** Classify a local, in-container HTTP probe without guessing from probe errors. */
export function classifyManagerHealth(
  container: { running?: boolean } | null,
  probe: CommandResult,
): { status: ManagerHealthStatus; response_status: number | null } {
  if (container?.running === false) return { status: "down", response_status: null };
  if (!container?.running || !probe.success) return { status: "unknown", response_status: null };
  try {
    const result: unknown = JSON.parse(probe.output);
    if (!result || typeof result !== "object" || typeof (result as { status?: unknown }).status !== "number") {
      return { status: "unknown", response_status: null };
    }
    const responseStatus = (result as { status: number }).status;
    return {
      status: responseStatus >= 200 && responseStatus < 300 ? "running" : "down",
      response_status: responseStatus,
    };
  } catch {
    return { status: "unknown", response_status: null };
  }
}
