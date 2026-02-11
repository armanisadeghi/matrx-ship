import { useState } from "react";
import { useTicketConfig } from "./context";
import { TicketForm } from "./TicketForm";

export interface TicketButtonProps {
  /** Position of the floating button */
  position?: "bottom-right" | "bottom-left";
  /** Custom label text */
  label?: string;
  /** CSS class name for the button */
  className?: string;
}

export function TicketButton({
  position = "bottom-right",
  label,
  className,
}: TicketButtonProps) {
  const config = useTicketConfig();
  const [open, setOpen] = useState(false);

  const positionClass =
    position === "bottom-left" ? "mtw-pos-bl" : "mtw-pos-br";

  return (
    <>
      {/* Floating button */}
      <button
        className={`mtw-fab ${positionClass} ${className ?? ""}`}
        data-theme={config.theme}
        style={{ zIndex: config.zIndex ?? 9999 }}
        onClick={() => setOpen(true)}
        aria-label="Report an issue"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <rect width="18" height="18" x="3" y="4" rx="2" />
          <path d="M3 10h18" />
          <path d="m9 16 2 2 4-4" />
        </svg>
        {label && <span className="mtw-fab-label">{label}</span>}
      </button>

      {/* Form overlay */}
      {open && (
        <div
          className="mtw-overlay"
          data-theme={config.theme}
          style={{ zIndex: (config.zIndex ?? 9999) + 1 }}
        >
          <div className={`mtw-panel ${positionClass}`}>
            <TicketForm
              onClose={() => setOpen(false)}
              onSubmitted={() => {
                // Keep the success state visible; onClose handles dismissal
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
