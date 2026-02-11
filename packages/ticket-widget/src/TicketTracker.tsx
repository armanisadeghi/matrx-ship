import { useState, useEffect } from "react";
import { useTicketConfig } from "./context";
import { apiCall } from "./utils";
import type { TimelineEntry } from "./types";

export interface TicketTrackerProps {
  /** Ticket number (the T-XXX number) to track */
  ticketNumber: number;
  /** CSS class name */
  className?: string;
}

interface TicketData {
  id: string;
  ticketNumber: number;
  title: string;
  status: string;
  ticketType: string;
  createdAt: string;
}

const STEPS = [
  { label: "Submitted", statuses: ["new"] },
  { label: "Reviewing", statuses: ["triaged", "approved", "in_progress"] },
  { label: "Testing", statuses: ["in_review"] },
  { label: "Your Feedback", statuses: ["user_review"] },
  { label: "Resolved", statuses: ["resolved", "closed"] },
];

export function TicketTracker({ ticketNumber, className }: TicketTrackerProps) {
  const config = useTicketConfig();
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const reporterParam = config.reporterId
          ? `&reporter_id=${encodeURIComponent(config.reporterId)}`
          : "";

        const listData = await apiCall<{ tickets: TicketData[] }>(
          config.baseUrl,
          `/api/tickets?sort=ticket_number&limit=100${reporterParam}`,
          { reporterToken: config.reporterToken },
        );

        const found = listData.tickets.find(
          (t) => t.ticketNumber === ticketNumber,
        );

        if (!found) {
          setError(`Ticket T-${ticketNumber} not found.`);
          return;
        }

        setTicket(found);

        // Fetch user-visible timeline
        try {
          const tlData = await apiCall<{ timeline: TimelineEntry[] }>(
            config.baseUrl,
            `/api/tickets/${found.id}/timeline?visibility=user_visible${reporterParam}`,
            { reporterToken: config.reporterToken },
          );
          setTimeline(tlData.timeline ?? []);
        } catch {
          // non-critical
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [ticketNumber, config.baseUrl, config.reporterToken, config.reporterId]);

  if (loading) {
    return (
      <div className={`mtw-tracker ${className ?? ""}`} data-theme={config.theme}>
        <div className="mtw-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`mtw-tracker ${className ?? ""}`} data-theme={config.theme}>
        <div className="mtw-error">{error}</div>
      </div>
    );
  }

  if (!ticket) return null;

  const currentIdx = STEPS.findIndex((s) => s.statuses.includes(ticket.status));
  const stepIdx = currentIdx >= 0 ? currentIdx : 0;

  return (
    <div className={`mtw-tracker ${className ?? ""}`} data-theme={config.theme}>
      <div className="mtw-tracker-header">
        <span className="mtw-ticket-number">T-{ticket.ticketNumber}</span>
        <span className="mtw-ticket-title">{ticket.title}</span>
      </div>

      {/* Progress stepper */}
      <div className="mtw-stepper">
        {STEPS.map((step, i) => (
          <div
            key={step.label}
            className={`mtw-step ${i <= stepIdx ? "mtw-step-done" : ""} ${i === stepIdx ? "mtw-step-active" : ""}`}
          >
            <div className="mtw-step-dot" />
            <span className="mtw-step-label">{step.label}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      {timeline.length > 0 && (
        <div className="mtw-timeline">
          <h4 className="mtw-timeline-title">Updates</h4>
          {timeline.map((entry) => (
            <div key={entry.id} className="mtw-timeline-entry">
              <div className="mtw-timeline-meta">
                <span className="mtw-timeline-author">
                  {entry.authorName ?? entry.authorType}
                </span>
                <span className="mtw-timeline-time">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </span>
              </div>
              {entry.content && (
                <p className="mtw-timeline-content">{entry.content}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
