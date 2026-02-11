import { useState, type FormEvent } from "react";
import { useTicketConfig } from "./context";
import { apiCall, captureEnvironment, generateClientRefId } from "./utils";
import type { TicketResponse, TicketSubmission } from "./types";

export interface TicketFormProps {
  /** Called after successful submission */
  onSubmitted?: (ticket: TicketResponse) => void;
  /** Called on close/cancel */
  onClose?: () => void;
  /** Default ticket type */
  defaultType?: string;
  /** CSS class name */
  className?: string;
}

const TYPES = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "suggestion", label: "Suggestion" },
  { value: "task", label: "Task" },
  { value: "enhancement", label: "Enhancement" },
];

export function TicketForm({
  onSubmitted,
  onClose,
  defaultType,
  className,
}: TicketFormProps) {
  const config = useTicketConfig();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState(defaultType ?? config.defaultType ?? "bug");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<TicketResponse | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const env = captureEnvironment();
      const payload: TicketSubmission = {
        title,
        description,
        ticket_type: type,
        route: env.route,
        browser_info: env.browserInfo,
        os_info: env.osInfo,
        reporter_id: config.reporterId ?? config.reporterEmail,
        reporter_name: config.reporterName,
        reporter_email: config.reporterEmail,
        project_id: config.projectId ?? "default",
        source: "sdk",
        client_reference_id: generateClientRefId(),
      };

      const result = await apiCall<TicketResponse>(
        config.baseUrl,
        "/api/tickets/submit",
        {
          method: "POST",
          body: payload,
          reporterToken: config.reporterToken,
        },
      );

      setSuccess(result);
      onSubmitted?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className={`mtw-form ${className ?? ""}`} data-theme={config.theme}>
        <div className="mtw-success">
          <div className="mtw-success-icon">✓</div>
          <h3 className="mtw-success-title">Ticket Submitted!</h3>
          <p className="mtw-success-number">T-{success.ticket_number}</p>
          <p className="mtw-success-text">
            We&apos;ll get back to you as soon as possible.
          </p>
          <button className="mtw-btn mtw-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={`mtw-form ${className ?? ""}`}
      data-theme={config.theme}
      onSubmit={handleSubmit}
    >
      <div className="mtw-form-header">
        <h3 className="mtw-form-title">Submit a Ticket</h3>
        {onClose && (
          <button type="button" className="mtw-form-close" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      {error && <div className="mtw-error">{error}</div>}

      <div className="mtw-field">
        <label className="mtw-label">Type</label>
        <select
          className="mtw-select"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mtw-field">
        <label className="mtw-label">Title *</label>
        <input
          className="mtw-input"
          type="text"
          placeholder="Brief summary"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="mtw-field">
        <label className="mtw-label">Description *</label>
        <textarea
          className="mtw-textarea"
          placeholder="Provide details..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          required
        />
      </div>

      <button
        type="submit"
        className="mtw-btn mtw-btn-primary"
        disabled={submitting}
      >
        {submitting ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
