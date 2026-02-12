"use client";

import { useState, useEffect } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Clock,
  Eye,
  Loader2,
  MessageSquare,
  Search,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { type Ticket } from "@/lib/db/schema";
import { toast } from "sonner";
import { TicketDetailDialog } from "@/components/admin/ticket-detail-dialog";
import { WorkQueue } from "@/components/admin/ticket-work-queue";
import { TicketStats } from "@/components/admin/ticket-stats";
import { TicketSystemDocs } from "@/components/admin/ticket-system-docs";

// ─── Pipeline Stage Definitions ─────────────────
const PIPELINE_STAGES = [
  { key: "all", label: "All", icon: Circle, statuses: [] },
  { key: "untriaged", label: "Untriaged", icon: Circle, statuses: ["new"] },
  { key: "your-decision", label: "Your Decision", icon: Clock, statuses: ["triaged"] },
  { key: "agent-working", label: "Agent Working", icon: ArrowUpRight, statuses: ["approved", "in_progress"] },
  { key: "testing", label: "Testing", icon: Eye, statuses: ["in_review"] },
  { key: "user-review", label: "User Review", icon: MessageSquare, statuses: ["user_review"] },
  { key: "done", label: "Done", icon: CheckCircle2, statuses: ["resolved", "closed"] },
] as const;

// ─── Style Helpers ──────────────────────────────
function statusBadge(status: string) {
  const variants: Record<string, string> = {
    new: "bg-muted text-muted-foreground",
    triaged: "bg-chart-4/15 text-chart-4",
    approved: "bg-chart-2/15 text-chart-2",
    in_progress: "bg-chart-1/15 text-chart-1",
    in_review: "bg-chart-3/15 text-chart-3",
    user_review: "bg-chart-5/15 text-chart-5",
    resolved: "bg-primary/15 text-primary",
    closed: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium", variants[status] ?? "bg-muted text-muted-foreground")}>
      {status.replace("_", " ")}
    </span>
  );
}

function priorityBadge(priority: string | null) {
  if (!priority) return <span className="text-xs text-muted-foreground">—</span>;
  const variants: Record<string, string> = {
    critical: "bg-destructive/15 text-destructive",
    high: "bg-chart-4/15 text-chart-4",
    medium: "bg-chart-1/15 text-chart-1",
    low: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize", variants[priority] ?? "bg-muted text-muted-foreground")}>
      {priority}
    </span>
  );
}

function typeBadge(type: string) {
  const variants: Record<string, string> = {
    bug: "text-destructive",
    feature: "text-chart-2",
    suggestion: "text-chart-1",
    task: "text-chart-3",
    enhancement: "text-chart-5",
  };
  return (
    <span className={cn("text-xs font-medium capitalize", variants[type] ?? "text-muted-foreground")}>
      {type}
    </span>
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

// ─── Column Definitions ─────────────────────────
function getColumns(onOpenTicket: (ticket: Ticket) => void, onQuickApprove: (ticket: Ticket) => void): ColumnDef<Ticket>[] {
  return [
    {
      accessorKey: "ticketNumber",
      header: "#",
      cell: ({ row }) => (
        <button
          className="font-mono text-sm font-medium text-primary hover:underline"
          onClick={() => onOpenTicket(row.original)}
        >
          T-{row.original.ticketNumber}
        </button>
      ),
      size: 70,
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => (
        <div className="max-w-md">
          <button
            className="text-sm font-medium text-foreground hover:underline text-left truncate block w-full"
            onClick={() => onOpenTicket(row.original)}
          >
            {row.original.title}
          </button>
          <div className="flex items-center gap-2 mt-0.5">
            {typeBadge(row.original.ticketType)}
            <span className="text-xs text-muted-foreground">
              via {row.original.source}
            </span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => statusBadge(row.original.status),
      size: 120,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) => priorityBadge(row.original.priority),
      size: 100,
    },
    {
      accessorKey: "assignee",
      header: "Assignee",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-[120px] block">
          {row.original.assignee ?? "—"}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: "createdAt",
      header: "Age",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {timeAgo(row.original.createdAt)}
        </span>
      ),
      size: 60,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const ticket = row.original;
        const showApprove = ticket.status === "triaged";
        return (
          <div className="flex items-center gap-1">
            {showApprove && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-chart-2 hover:text-chart-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickApprove(ticket);
                }}
              >
                <ThumbsUp className="w-3 h-3 mr-1" />
                Approve
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => onOpenTicket(ticket)}
            >
              <Eye className="w-3 h-3" />
            </Button>
          </div>
        );
      },
      size: 140,
    },
  ];
}

// ─── Main Page Component ────────────────────────
export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [pipelineCounts, setPipelineCounts] = useState<Record<string, number>>({});
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const fetchTickets = async () => {
    try {
      setLoading(true);
      const stage = PIPELINE_STAGES.find((s) => s.key === activeStage);
      const statusParams = stage?.statuses.map((s) => `status=${s}`).join("&") ?? "";
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";
      const url = `/api/tickets?limit=50${statusParams ? `&${statusParams}` : ""}${searchParam}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch tickets");
      const data = await res.json();
      setTickets(data.tickets);
    } catch (err) {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  };

  const fetchPipelineCounts = async () => {
    try {
      const res = await fetch("/api/tickets/stats");
      if (!res.ok) return;
      const data = await res.json();
      setPipelineCounts({
        untriaged: data.pipeline.untriaged,
        "your-decision": data.pipeline.yourDecision,
        "agent-working": data.pipeline.agentWorking,
        testing: data.pipeline.testing,
        "user-review": data.pipeline.userReview,
        done: data.pipeline.done,
      });
    } catch {
      // Silently fail — counts are non-critical
    }
  };

  useEffect(() => {
    fetchTickets();
    fetchPipelineCounts();
  }, [activeStage, searchQuery]);

  const handleOpenTicket = (ticket: Ticket) => {
    setSelectedTicket(ticket);
  };

  const handleQuickApprove = async (ticket: Ticket) => {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          actor_type: "admin",
          actor_name: "Admin",
        }),
      });
      if (!res.ok) throw new Error("Failed to approve");
      toast.success(`T-${ticket.ticketNumber} approved`);
      fetchTickets();
      fetchPipelineCounts();
    } catch {
      toast.error("Failed to approve ticket");
    }
  };

  const columns = getColumns(handleOpenTicket, handleQuickApprove);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tickets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage bugs, features, suggestions, and tasks
          </p>
        </div>
      </div>

      {/* Top-level view tabs */}
      <Tabs defaultValue="pipeline" className="space-y-6">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="work-queue">Work Queue</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="docs">Connect & Tools</TabsTrigger>
        </TabsList>

        {/* Pipeline View */}
        <TabsContent value="pipeline" className="space-y-6 mt-0">
          {/* Pipeline stage tabs */}
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl overflow-x-auto">
            {PIPELINE_STAGES.map((stage) => {
              const count = stage.key === "all"
                ? tickets.length
                : pipelineCounts[stage.key] ?? 0;

              return (
                <button
                  key={stage.key}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                    activeStage === stage.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setActiveStage(stage.key)}
                >
                  <stage.icon className="w-3.5 h-3.5" />
                  {stage.label}
                  {count > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-0.5 h-5 min-w-5 px-1.5 text-[10px]"
                    >
                      {count}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search bar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={tickets}
              showToolbar={false}
              showPagination={true}
              pageSize={20}
            />
          )}
        </TabsContent>

        {/* Work Queue View */}
        <TabsContent value="work-queue" className="mt-0">
          <WorkQueue onOpenTicket={handleOpenTicket} />
        </TabsContent>

        {/* Stats View */}
        <TabsContent value="stats" className="mt-0">
          <TicketStats />
        </TabsContent>

        {/* Docs View */}
        <TabsContent value="docs" className="mt-0">
          <TicketSystemDocs />
        </TabsContent>
      </Tabs>

      {/* Ticket detail dialog */}
      {selectedTicket && (
        <TicketDetailDialog
          ticket={selectedTicket}
          onClose={() => {
            setSelectedTicket(null);
            fetchTickets();
            fetchPipelineCounts();
          }}
        />
      )}
    </div>
  );
}

