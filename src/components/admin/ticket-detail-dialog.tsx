"use client";

import { useState, useEffect } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  Shield,
  ThumbsUp,
  Upload,
  X,
  Cpu,
  Link2,
  User,
  Bot,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type Ticket, type TicketActivity, type TicketAttachment } from "@/lib/db/schema";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────
interface TicketDetailDialogProps {
  ticket: Ticket;
  onClose: () => void;
}

// ─── Activity stream helpers ────────────────────
function activityIcon(type: string, authorType: string) {
  switch (type) {
    case "status_change": return <ArrowRight className="w-3.5 h-3.5" />;
    case "comment": return <MessageSquare className="w-3.5 h-3.5" />;
    case "message": return <Send className="w-3.5 h-3.5" />;
    case "decision": return <Shield className="w-3.5 h-3.5" />;
    case "test_result": return <CheckCircle2 className="w-3.5 h-3.5" />;
    case "assignment": return <User className="w-3.5 h-3.5" />;
    case "resolution": return <CheckCircle2 className="w-3.5 h-3.5" />;
    case "field_change": return <Settings2 className="w-3.5 h-3.5" />;
    case "system": return <Cpu className="w-3.5 h-3.5" />;
    default: return <MessageSquare className="w-3.5 h-3.5" />;
  }
}

function activityColor(type: string): string {
  switch (type) {
    case "status_change": return "text-chart-1 bg-chart-1/10";
    case "comment": return "text-chart-3 bg-chart-3/10";
    case "message": return "text-chart-2 bg-chart-2/10";
    case "decision": return "text-chart-4 bg-chart-4/10";
    case "test_result": return "text-primary bg-primary/10";
    case "resolution": return "text-primary bg-primary/10";
    case "field_change": return "text-muted-foreground bg-muted";
    case "system": return "text-muted-foreground bg-muted";
    default: return "text-muted-foreground bg-muted";
  }
}

function authorBadge(authorType: string) {
  const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    admin: { label: "Admin", className: "bg-chart-4/15 text-chart-4", icon: <Shield className="w-2.5 h-2.5" /> },
    agent: { label: "Agent", className: "bg-chart-2/15 text-chart-2", icon: <Bot className="w-2.5 h-2.5" /> },
    user: { label: "User", className: "bg-chart-3/15 text-chart-3", icon: <User className="w-2.5 h-2.5" /> },
    system: { label: "System", className: "bg-muted text-muted-foreground", icon: <Cpu className="w-2.5 h-2.5" /> },
  };
  const info = map[authorType] ?? map.system;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", info.className)}>
      {info.icon} {info.label}
    </span>
  );
}

function formatTime(date: string | Date) {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Main Component ─────────────────────────────
export function TicketDetailDialog({ ticket, onClose }: TicketDetailDialogProps) {
  const [timeline, setTimeline] = useState<TicketActivity[]>([]);
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("timeline");
  const [replyContent, setReplyContent] = useState("");
  const [replyType, setReplyType] = useState<"comment" | "message">("comment");
  const [sending, setSending] = useState(false);

  // Editable fields
  const [editStatus, setEditStatus] = useState(ticket.status);
  const [editPriority, setEditPriority] = useState(ticket.priority ?? "");
  const [editAssignee, setEditAssignee] = useState(ticket.assignee ?? "");
  const [editDirection, setEditDirection] = useState(ticket.direction ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTimeline();
    fetchAttachments();
  }, [ticket.id]);

  const fetchTimeline = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/timeline`);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      const data = await res.json();
      setTimeline(data.timeline);
    } catch {
      toast.error("Failed to load timeline");
    } finally {
      setLoading(false);
    }
  };

  const fetchAttachments = async () => {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/attachments`);
      if (!res.ok) return;
      const data = await res.json();
      setAttachments(data.attachments);
    } catch {
      // non-critical
    }
  };

  const handleReply = async () => {
    if (!replyContent.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: replyType,
          content: replyContent,
          actor_type: "admin",
          actor_name: "Admin",
        }),
      });
      if (!res.ok) throw new Error("Failed to send");
      setReplyContent("");
      toast.success(replyType === "message" ? "Message sent" : "Comment added");
      fetchTimeline();
    } catch {
      toast.error("Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleApproveActivity = async (activityId: string) => {
    try {
      const res = await fetch(
        `/api/tickets/${ticket.id}/activity/${activityId}/approve`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      if (!res.ok) throw new Error("Failed");
      toast.success("Draft approved");
      fetchTimeline();
    } catch {
      toast.error("Failed to approve draft");
    }
  };

  const handlePromoteActivity = async (activityId: string) => {
    try {
      const res = await fetch(
        `/api/tickets/${ticket.id}/activity/${activityId}/promote`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      if (!res.ok) throw new Error("Failed");
      toast.success("Made visible to user");
      fetchTimeline();
    } catch {
      toast.error("Failed to promote");
    }
  };

  const handleSaveDetails = async () => {
    setSaving(true);
    try {
      // Update fields
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority: editPriority || null,
          assignee: editAssignee || null,
          direction: editDirection || null,
          actor_type: "admin",
          actor_name: "Admin",
        }),
      });
      if (!res.ok) throw new Error("Failed");

      // Status change if different
      if (editStatus !== ticket.status) {
        const statusRes = await fetch(`/api/tickets/${ticket.id}/activity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "change_status",
            status: editStatus,
            actor_type: "admin",
            actor_name: "Admin",
          }),
        });
        if (!statusRes.ok) throw new Error("Failed to change status");
      }

      toast.success("Ticket updated");
      fetchTimeline();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-mono font-bold text-primary shrink-0">T-{ticket.ticketNumber}</span>
            <h2 className="text-base font-semibold text-foreground truncate">{ticket.title}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <Button variant="ghost" size="sm" onClick={onClose} className="ml-2">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="px-6 pt-2 bg-transparent justify-start border-b border-border rounded-none gap-0">
            <TabsTrigger value="timeline" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
              Timeline
            </TabsTrigger>
            <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
              Details
            </TabsTrigger>
            <TabsTrigger value="ai" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
              AI Analysis
            </TabsTrigger>
            <TabsTrigger value="attachments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
              Attachments
              {attachments.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">
                  {attachments.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="related" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
              Related
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-auto">
            {/* Timeline Tab */}
            <TabsContent value="timeline" className="mt-0 h-full flex flex-col">
              <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  </div>
                ) : timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>
                ) : (
                  timeline.map((entry) => (
                    <TimelineEntry
                      key={entry.id}
                      entry={entry}
                      onApprove={handleApproveActivity}
                      onPromote={handlePromoteActivity}
                    />
                  ))
                )}
              </div>

              {/* Reply input */}
              <div className="border-t border-border px-6 py-3">
                <div className="flex items-start gap-2">
                  <Select value={replyType} onValueChange={(v) => setReplyType(v as "comment" | "message")}>
                    <SelectTrigger className="w-[110px] h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comment">Comment</SelectItem>
                      <SelectItem value="message">Message</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder={replyType === "comment" ? "Add internal comment..." : "Send message to user..."}
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
                {replyType === "message" && (
                  <p className="text-[10px] text-chart-4 mt-1 ml-[118px]">
                    Messages are visible to the user who submitted this ticket.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* Details Tab */}
            <TabsContent value="details" className="mt-0 px-6 py-4">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={editStatus} onValueChange={setEditStatus}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["new", "triaged", "approved", "in_progress", "in_review", "user_review", "resolved", "closed"].map((s) => (
                          <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Priority</Label>
                    <Select value={editPriority} onValueChange={setEditPriority}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Not set" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Assignee</Label>
                    <Input value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)} placeholder="Unassigned" className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Direction</Label>
                    <Textarea value={editDirection} onChange={(e) => setEditDirection(e.target.value)} placeholder="Instructions for the developer..." className="mt-1" rows={3} />
                  </div>
                  <Button onClick={handleSaveDetails} disabled={saving} className="w-full">
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </div>

                <div className="space-y-4">
                  <DetailRow label="Type" value={ticket.ticketType} />
                  <DetailRow label="Source" value={ticket.source} />
                  <DetailRow label="Reporter" value={ticket.reporterName ?? ticket.reporterId} />
                  <DetailRow label="Email" value={ticket.reporterEmail} />
                  <DetailRow label="Route" value={ticket.route} />
                  <DetailRow label="Environment" value={ticket.environment} />
                  <DetailRow label="Browser" value={ticket.browserInfo} />
                  <DetailRow label="OS" value={ticket.osInfo} />
                  <DetailRow label="Resolution" value={ticket.resolution} />
                  <DetailRow label="Tags" value={ticket.tags?.join(", ")} />
                  <DetailRow label="Created" value={formatTime(ticket.createdAt)} />
                </div>
              </div>

              <Separator className="my-6" />

              <div>
                <h3 className="text-sm font-medium text-foreground mb-2">Description</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>
              </div>
            </TabsContent>

            {/* AI Analysis Tab */}
            <TabsContent value="ai" className="mt-0 px-6 py-4">
              {ticket.aiAssessment ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-primary" />
                      Assessment
                    </h3>
                    <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{ticket.aiAssessment}</p>
                  </div>
                  {ticket.aiSolutionProposal && (
                    <div>
                      <h3 className="text-sm font-medium text-foreground">Solution Proposal</h3>
                      <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{ticket.aiSolutionProposal}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-4">
                    <MetricCard label="Complexity" value={ticket.aiComplexity ?? "—"} />
                    <MetricCard label="Priority" value={ticket.aiSuggestedPriority ?? "—"} />
                    <MetricCard label="Autonomy Score" value={ticket.autonomyScore?.toString() ?? "—"} />
                  </div>
                  {ticket.aiEstimatedFiles && ticket.aiEstimatedFiles.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-foreground mb-2">Estimated Files</h3>
                      <div className="space-y-1">
                        {ticket.aiEstimatedFiles.map((file, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-lg">
                            <FileText className="w-3 h-3 shrink-0" />
                            {file}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Cpu className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No AI analysis yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">An agent will triage this ticket and provide analysis.</p>
                </div>
              )}
            </TabsContent>

            {/* Attachments Tab */}
            <TabsContent value="attachments" className="mt-0 px-6 py-4">
              {attachments.length > 0 ? (
                <div className="space-y-2">
                  {attachments.map((att) => (
                    <div key={att.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                      <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{att.originalName}</p>
                        <p className="text-xs text-muted-foreground">
                          {att.mimeType} &middot; {(att.sizeBytes / 1024).toFixed(1)} KB &middot; by {att.uploadedBy}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Paperclip className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No attachments yet.</p>
                </div>
              )}
            </TabsContent>

            {/* Related Tab */}
            <TabsContent value="related" className="mt-0 px-6 py-4">
              <div className="space-y-4">
                {ticket.parentId ? (
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                      <Link2 className="w-4 h-4" /> Parent Ticket
                    </h3>
                    <p className="text-sm text-muted-foreground font-mono">
                      {ticket.parentId}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Link2 className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {ticket.parentId ? "Child tickets will appear here." : "No related tickets."}
                  </p>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────

function TimelineEntry({
  entry,
  onApprove,
  onPromote,
}: {
  entry: TicketActivity;
  onApprove: (id: string) => void;
  onPromote: (id: string) => void;
}) {
  const meta = entry.metadata as Record<string, unknown> | null;

  return (
    <div className={cn("flex gap-3 group", entry.visibility === "internal" ? "opacity-80" : "")}>
      {/* Icon */}
      <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5", activityColor(entry.activityType))}>
        {activityIcon(entry.activityType, entry.authorType)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{entry.authorName ?? entry.authorType}</span>
          {authorBadge(entry.authorType)}
          <span className="text-[10px] text-muted-foreground">{formatTime(entry.createdAt)}</span>
          {entry.visibility === "internal" && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <EyeOff className="w-2.5 h-2.5" /> internal
            </span>
          )}
          {entry.requiresApproval && !entry.approvedAt && (
            <Badge variant="outline" className="h-4 text-[10px] px-1.5 text-chart-4 border-chart-4/30">
              Pending approval
            </Badge>
          )}
        </div>

        {/* Activity type-specific content */}
        {entry.activityType === "status_change" && meta ? (
          <p className="text-sm text-muted-foreground mt-0.5">
            <span className="font-medium">{String(meta.from ?? "?")}</span>
            <ArrowRight className="w-3 h-3 inline mx-1" />
            <span className="font-medium">{String(meta.to ?? "?")}</span>
          </p>
        ) : entry.activityType === "field_change" && meta ? (
          <p className="text-sm text-muted-foreground mt-0.5">
            Changed <span className="font-mono text-xs">{String(meta.field)}</span>
          </p>
        ) : entry.content ? (
          <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">{entry.content}</p>
        ) : null}

        {/* Action buttons */}
        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {entry.requiresApproval && !entry.approvedAt && (
            <Button variant="ghost" size="sm" className="h-6 text-[11px] text-chart-2" onClick={() => onApprove(entry.id)}>
              <ThumbsUp className="w-3 h-3 mr-1" /> Approve
            </Button>
          )}
          {entry.visibility === "internal" && (
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => onPromote(entry.id)}>
              <Eye className="w-3 h-3 mr-1" /> Make visible
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
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

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
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

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground mt-0.5">{value || "—"}</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-xl p-4 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground mt-1 capitalize">{value}</p>
    </div>
  );
}
