"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TicketSummary {
  id: string;
  ticketNumber: number;
  title: string;
  description: string;
  status: string;
  ticketType: string;
  priority: string | null;
  createdAt: string;
  resolution: string | null;
}

interface TimelineEntry {
  id: string;
  activityType: string;
  authorType: string;
  authorName: string | null;
  content: string | null;
  visibility: string;
  createdAt: string;
}

// ─── Progress Stepper ───────────────────────────
const STEPS = [
  { key: "submitted", label: "Submitted", statuses: ["new"] },
  { key: "reviewing", label: "Reviewing", statuses: ["triaged", "approved", "in_progress"] },
  { key: "testing", label: "Testing", statuses: ["in_review"] },
  { key: "feedback", label: "Your Feedback", statuses: ["user_review"] },
  { key: "done", label: "Resolved", statuses: ["resolved", "closed"] },
];

function getStepIndex(status: string): number {
  const idx = STEPS.findIndex((s) => s.statuses.includes(status));
  return idx >= 0 ? idx : 0;
}

export default function PortalTicketPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = use(params);
  const [ticket, setTicket] = useState<TicketSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  const fetchTicket = async (reporterId: string) => {
    try {
      // Use list API with a search that matches the ticket number
      const res = await fetch(`/api/tickets?sort=ticket_number&limit=50`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();

      const found = data.tickets.find(
        (t: TicketSummary) => t.ticketNumber === Number(number),
      );

      if (!found) {
        setNotFound(true);
        return;
      }

      setTicket(found);

      // Fetch user-visible timeline
      const timelineRes = await fetch(
        `/api/tickets/${found.id}/timeline?visibility=user_visible`,
      );
      if (timelineRes.ok) {
        const tData = await timelineRes.json();
        setTimeline(tData.timeline ?? []);
      }
    } catch {
      toast.error("Failed to load ticket");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Try to load the ticket (no auth for now in dev)
    fetchTicket("");
  }, [number]);

  const handleReply = async () => {
    if (!replyContent.trim() || !ticket) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          content: replyContent,
          actor_type: "user",
          actor_name: email || "User",
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setReplyContent("");
      toast.success("Message sent");
      fetchTicket("");
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="text-center py-20">
        <p className="text-lg font-medium text-foreground">Ticket Not Found</p>
        <p className="text-sm text-muted-foreground mt-2">
          We couldn&apos;t find ticket T-{number}. Please check the number and try again.
        </p>
        <Link href="/portal">
          <Button className="mt-6">Back to Portal</Button>
        </Link>
      </div>
    );
  }

  if (!ticket) return null;

  const currentStep = getStepIndex(ticket.status);

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link href="/portal" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Back to Portal
      </Link>

      {/* Ticket header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-sm font-mono font-bold text-primary">T-{ticket.ticketNumber}</span>
          <Badge variant="secondary" className="capitalize">{ticket.ticketType}</Badge>
          {ticket.priority && (
            <Badge variant="outline" className="capitalize">{ticket.priority}</Badge>
          )}
        </div>
        <h1 className="text-xl font-bold text-foreground">{ticket.title}</h1>
        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{ticket.description}</p>
      </div>

      {/* Progress stepper */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-sm font-medium text-foreground mb-4">Progress</h2>
        <div className="flex items-center justify-between relative">
          {/* Connector line */}
          <div className="absolute top-3.5 left-0 right-0 h-0.5 bg-border" />
          <div
            className="absolute top-3.5 left-0 h-0.5 bg-primary transition-all"
            style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%` }}
          />

          {STEPS.map((step, i) => (
            <div key={step.key} className="flex flex-col items-center relative z-10">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center border-2",
                  i < currentStep
                    ? "bg-primary border-primary text-primary-foreground"
                    : i === currentStep
                      ? "bg-primary border-primary text-primary-foreground"
                      : "bg-background border-border text-muted-foreground",
                )}
              >
                {i < currentStep ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : i === currentStep ? (
                  <Clock className="w-3.5 h-3.5" />
                ) : (
                  <Circle className="w-3 h-3" />
                )}
              </div>
              <span
                className={cn(
                  "text-[11px] mt-1.5 font-medium text-center",
                  i <= currentStep ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline (user-visible entries only) */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-sm font-medium text-foreground mb-4">Updates</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No updates yet. We&apos;ll post updates as your ticket progresses.
          </p>
        ) : (
          <div className="space-y-4">
            {timeline.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  {entry.activityType === "message" ? (
                    <MessageSquare className="w-3 h-3 text-primary" />
                  ) : entry.activityType === "status_change" ? (
                    <ArrowRight className="w-3 h-3 text-chart-1" />
                  ) : (
                    <Circle className="w-2.5 h-2.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {entry.authorName ?? entry.authorType}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {entry.content && (
                    <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">
                      {entry.content}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reply input */}
        <div className="mt-6 pt-4 border-t border-border">
          <div className="flex items-start gap-2">
            <Input
              placeholder="Send a message..."
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleReply();
                }
              }}
              className="h-9"
            />
            <Button size="sm" onClick={handleReply} disabled={sending || !replyContent.trim()} className="h-9">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
