'use strict';

var react = require('react');
var jsxRuntime = require('react/jsx-runtime');

// src/context.tsx
var TicketContext = react.createContext(null);
function useTicketConfig() {
  const ctx = react.useContext(TicketContext);
  if (!ctx) {
    throw new Error("useTicketConfig must be used within a <TicketProvider>");
  }
  return ctx;
}
function TicketProvider({
  config,
  children
}) {
  return /* @__PURE__ */ jsxRuntime.jsx(TicketContext.Provider, { value: config, children });
}

// src/utils.ts
function captureEnvironment() {
  if (typeof window === "undefined") {
    return { browserInfo: "server", osInfo: "server", route: "/" };
  }
  const ua = navigator.userAgent;
  const platform = navigator.platform ?? "unknown";
  let browser = "unknown";
  if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  let os = platform;
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Android")) os = "Android";
  return {
    browserInfo: `${browser} (${ua.slice(0, 100)})`,
    osInfo: os,
    route: window.location.pathname
  };
}
function generateClientRefId() {
  return `tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
async function apiCall(baseUrl, path, options = {}) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers = {
    "Content-Type": "application/json"
  };
  if (options.reporterToken) {
    headers["X-Reporter-Token"] = options.reporterToken;
  }
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : void 0
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(errData.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
var TYPES = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "suggestion", label: "Suggestion" },
  { value: "task", label: "Task" },
  { value: "enhancement", label: "Enhancement" }
];
function TicketForm({
  onSubmitted,
  onClose,
  defaultType,
  className
}) {
  const config = useTicketConfig();
  const [title, setTitle] = react.useState("");
  const [description, setDescription] = react.useState("");
  const [type, setType] = react.useState(defaultType ?? config.defaultType ?? "bug");
  const [submitting, setSubmitting] = react.useState(false);
  const [error, setError] = react.useState(null);
  const [success, setSuccess] = react.useState(null);
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const env = captureEnvironment();
      const payload = {
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
        client_reference_id: generateClientRefId()
      };
      const result = await apiCall(
        config.baseUrl,
        "/api/tickets/submit",
        {
          method: "POST",
          body: payload,
          reporterToken: config.reporterToken
        }
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
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: `mtw-form ${className ?? ""}`, "data-theme": config.theme, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-success", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mtw-success-icon", children: "\u2713" }),
      /* @__PURE__ */ jsxRuntime.jsx("h3", { className: "mtw-success-title", children: "Ticket Submitted!" }),
      /* @__PURE__ */ jsxRuntime.jsxs("p", { className: "mtw-success-number", children: [
        "T-",
        success.ticket_number
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("p", { className: "mtw-success-text", children: "We'll get back to you as soon as possible." }),
      /* @__PURE__ */ jsxRuntime.jsx("button", { className: "mtw-btn mtw-btn-primary", onClick: onClose, children: "Close" })
    ] }) });
  }
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "form",
    {
      className: `mtw-form ${className ?? ""}`,
      "data-theme": config.theme,
      onSubmit: handleSubmit,
      children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-form-header", children: [
          /* @__PURE__ */ jsxRuntime.jsx("h3", { className: "mtw-form-title", children: "Submit a Ticket" }),
          onClose && /* @__PURE__ */ jsxRuntime.jsx("button", { type: "button", className: "mtw-form-close", onClick: onClose, children: "\xD7" })
        ] }),
        error && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mtw-error", children: error }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-field", children: [
          /* @__PURE__ */ jsxRuntime.jsx("label", { className: "mtw-label", children: "Type" }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "select",
            {
              className: "mtw-select",
              value: type,
              onChange: (e) => setType(e.target.value),
              children: TYPES.map((t) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: t.value, children: t.label }, t.value))
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-field", children: [
          /* @__PURE__ */ jsxRuntime.jsx("label", { className: "mtw-label", children: "Title *" }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              className: "mtw-input",
              type: "text",
              placeholder: "Brief summary",
              value: title,
              onChange: (e) => setTitle(e.target.value),
              required: true
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-field", children: [
          /* @__PURE__ */ jsxRuntime.jsx("label", { className: "mtw-label", children: "Description *" }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "textarea",
            {
              className: "mtw-textarea",
              placeholder: "Provide details...",
              value: description,
              onChange: (e) => setDescription(e.target.value),
              rows: 4,
              required: true
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            type: "submit",
            className: "mtw-btn mtw-btn-primary",
            disabled: submitting,
            children: submitting ? "Submitting..." : "Submit"
          }
        )
      ]
    }
  );
}
function TicketButton({
  position = "bottom-right",
  label,
  className
}) {
  const config = useTicketConfig();
  const [open, setOpen] = react.useState(false);
  const positionClass = position === "bottom-left" ? "mtw-pos-bl" : "mtw-pos-br";
  return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
    /* @__PURE__ */ jsxRuntime.jsxs(
      "button",
      {
        className: `mtw-fab ${positionClass} ${className ?? ""}`,
        "data-theme": config.theme,
        style: { zIndex: config.zIndex ?? 9999 },
        onClick: () => setOpen(true),
        "aria-label": "Report an issue",
        children: [
          /* @__PURE__ */ jsxRuntime.jsxs(
            "svg",
            {
              width: "20",
              height: "20",
              viewBox: "0 0 24 24",
              fill: "none",
              stroke: "currentColor",
              strokeWidth: "2",
              strokeLinecap: "round",
              strokeLinejoin: "round",
              children: [
                /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8 2v4" }),
                /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M16 2v4" }),
                /* @__PURE__ */ jsxRuntime.jsx("rect", { width: "18", height: "18", x: "3", y: "4", rx: "2" }),
                /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M3 10h18" }),
                /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m9 16 2 2 4-4" })
              ]
            }
          ),
          label && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mtw-fab-label", children: label })
        ]
      }
    ),
    open && /* @__PURE__ */ jsxRuntime.jsx(
      "div",
      {
        className: "mtw-overlay",
        "data-theme": config.theme,
        style: { zIndex: (config.zIndex ?? 9999) + 1 },
        children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: `mtw-panel ${positionClass}`, children: /* @__PURE__ */ jsxRuntime.jsx(
          TicketForm,
          {
            onClose: () => setOpen(false),
            onSubmitted: () => {
            }
          }
        ) })
      }
    )
  ] });
}
var STEPS = [
  { label: "Submitted", statuses: ["new"] },
  { label: "Reviewing", statuses: ["triaged", "approved", "in_progress"] },
  { label: "Testing", statuses: ["in_review"] },
  { label: "Your Feedback", statuses: ["user_review"] },
  { label: "Resolved", statuses: ["resolved", "closed"] }
];
function TicketTracker({ ticketNumber, className }) {
  const config = useTicketConfig();
  const [ticket, setTicket] = react.useState(null);
  const [timeline, setTimeline] = react.useState([]);
  const [loading, setLoading] = react.useState(true);
  const [error, setError] = react.useState(null);
  react.useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const reporterParam = config.reporterId ? `&reporter_id=${encodeURIComponent(config.reporterId)}` : "";
        const listData = await apiCall(
          config.baseUrl,
          `/api/tickets?sort=ticket_number&limit=100${reporterParam}`,
          { reporterToken: config.reporterToken }
        );
        const found = listData.tickets.find(
          (t) => t.ticketNumber === ticketNumber
        );
        if (!found) {
          setError(`Ticket T-${ticketNumber} not found.`);
          return;
        }
        setTicket(found);
        try {
          const tlData = await apiCall(
            config.baseUrl,
            `/api/tickets/${found.id}/timeline?visibility=user_visible${reporterParam}`,
            { reporterToken: config.reporterToken }
          );
          setTimeline(tlData.timeline ?? []);
        } catch {
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
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: `mtw-tracker ${className ?? ""}`, "data-theme": config.theme, children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mtw-loading", children: "Loading..." }) });
  }
  if (error) {
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: `mtw-tracker ${className ?? ""}`, "data-theme": config.theme, children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mtw-error", children: error }) });
  }
  if (!ticket) return null;
  const currentIdx = STEPS.findIndex((s) => s.statuses.includes(ticket.status));
  const stepIdx = currentIdx >= 0 ? currentIdx : 0;
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: `mtw-tracker ${className ?? ""}`, "data-theme": config.theme, children: [
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-tracker-header", children: [
      /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "mtw-ticket-number", children: [
        "T-",
        ticket.ticketNumber
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mtw-ticket-title", children: ticket.title })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mtw-stepper", children: STEPS.map((step, i) => /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        className: `mtw-step ${i <= stepIdx ? "mtw-step-done" : ""} ${i === stepIdx ? "mtw-step-active" : ""}`,
        children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mtw-step-dot" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mtw-step-label", children: step.label })
        ]
      },
      step.label
    )) }),
    timeline.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-timeline", children: [
      /* @__PURE__ */ jsxRuntime.jsx("h4", { className: "mtw-timeline-title", children: "Updates" }),
      timeline.map((entry) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-timeline-entry", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mtw-timeline-meta", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mtw-timeline-author", children: entry.authorName ?? entry.authorType }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mtw-timeline-time", children: new Date(entry.createdAt).toLocaleDateString() })
        ] }),
        entry.content && /* @__PURE__ */ jsxRuntime.jsx("p", { className: "mtw-timeline-content", children: entry.content })
      ] }, entry.id))
    ] })
  ] });
}

exports.TicketButton = TicketButton;
exports.TicketForm = TicketForm;
exports.TicketProvider = TicketProvider;
exports.TicketTracker = TicketTracker;
exports.apiCall = apiCall;
exports.captureEnvironment = captureEnvironment;
exports.generateClientRefId = generateClientRefId;
exports.useTicketConfig = useTicketConfig;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map