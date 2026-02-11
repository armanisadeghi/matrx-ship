import { createContext, useContext, type ReactNode } from "react";
import type { TicketWidgetConfig } from "./types";

const TicketContext = createContext<TicketWidgetConfig | null>(null);

export function useTicketConfig(): TicketWidgetConfig {
  const ctx = useContext(TicketContext);
  if (!ctx) {
    throw new Error("useTicketConfig must be used within a <TicketProvider>");
  }
  return ctx;
}

export function TicketProvider({
  config,
  children,
}: {
  config: TicketWidgetConfig;
  children: ReactNode;
}) {
  return (
    <TicketContext.Provider value={config}>{children}</TicketContext.Provider>
  );
}
