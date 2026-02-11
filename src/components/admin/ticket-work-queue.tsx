"use client";

import { useState, useEffect } from "react";
import {
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Eye,
  GripVertical,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type Ticket } from "@/lib/db/schema";
import { toast } from "sonner";

interface WorkQueueProps {
  onOpenTicket: (ticket: Ticket) => void;
}

export function WorkQueue({ onOpenTicket }: WorkQueueProps) {
  const [queue, setQueue] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tickets/work-queue");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setQueue(data.queue);
    } catch {
      toast.error("Failed to load work queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleReorder = async (ticketId: string, newPriority: number) => {
    try {
      await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_priority: newPriority,
          actor_type: "admin",
          actor_name: "Admin",
        }),
      });
      fetchQueue();
    } catch {
      toast.error("Failed to reorder");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">Work queue is empty.</p>
        <p className="text-xs text-muted-foreground mt-1">Approve tickets to add them to the queue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {queue.map((ticket, i) => (
        <div
          key={ticket.id}
          className="flex items-center gap-3 p-3 bg-card border border-border rounded-xl hover:border-primary/30 transition-colors group"
        >
          {/* Priority handle */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <span className="text-xs font-mono text-muted-foreground w-6 text-center">
              #{ticket.workPriority ?? i + 1}
            </span>
            <div className="flex flex-col gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100"
                onClick={() => handleReorder(ticket.id, Math.max(1, (ticket.workPriority ?? i + 1) - 1))}
                disabled={i === 0}
              >
                <ArrowUpDown className="w-3 h-3 rotate-180" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <button
            className="flex-1 text-left min-w-0"
            onClick={() => onOpenTicket(ticket)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-medium text-primary">T-{ticket.ticketNumber}</span>
              <span className="text-sm text-foreground truncate">{ticket.title}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {ticket.aiComplexity && (
                <Badge variant="secondary" className="h-4 text-[10px] px-1.5 capitalize">
                  {ticket.aiComplexity}
                </Badge>
              )}
              {ticket.direction && (
                <span className="text-xs text-muted-foreground truncate max-w-xs">
                  {ticket.direction}
                </span>
              )}
            </div>
          </button>

          {/* Meta */}
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {timeAgo(ticket.updatedAt)}
            </div>
          </div>

          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onOpenTicket(ticket)}>
            <Eye className="w-4 h-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function timeAgo(date: string | Date) {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
