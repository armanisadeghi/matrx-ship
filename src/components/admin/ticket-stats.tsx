"use client";

import { useState, useEffect } from "react";
import {
  BarChart3,
  Bug,
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  Star,
  CalendarClock,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface StatsData {
  stats: {
    total: number;
    open: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    needingDecision: number;
    needingRework: number;
    followUpsDue: number;
    avgResolutionHours: number | null;
  };
  pipeline: {
    untriaged: number;
    yourDecision: number;
    agentWorking: number;
    testing: number;
    userReview: number;
    done: number;
    followUps: number;
  };
}

export function TicketStats() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/tickets/stats");
        if (!res.ok) throw new Error("Failed");
        const json = await res.json();
        setData(json);
      } catch {
        toast.error("Failed to load stats");
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground text-center py-8">Failed to load statistics.</p>;
  }

  const { stats, pipeline } = data;

  return (
    <div className="space-y-8">
      {/* Top-level metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={ListTodo} label="Total Tickets" value={stats.total} />
        <StatCard icon={BarChart3} label="Open" value={stats.open} highlight />
        <StatCard icon={AlertTriangle} label="Decisions Pending" value={stats.needingDecision} warn={stats.needingDecision > 0} />
        <StatCard icon={Clock} label="Avg Resolution" value={stats.avgResolutionHours != null ? `${stats.avgResolutionHours.toFixed(1)}h` : "—"} />
      </div>

      {/* Pipeline bar */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Pipeline</h3>
        <div className="flex rounded-xl overflow-hidden h-6">
          <PipelineSegment label="New" count={pipeline.untriaged} total={stats.total} className="bg-muted" />
          <PipelineSegment label="Decision" count={pipeline.yourDecision} total={stats.total} className="bg-chart-4/40" />
          <PipelineSegment label="Working" count={pipeline.agentWorking} total={stats.total} className="bg-chart-2/40" />
          <PipelineSegment label="Testing" count={pipeline.testing} total={stats.total} className="bg-chart-3/40" />
          <PipelineSegment label="Review" count={pipeline.userReview} total={stats.total} className="bg-chart-5/40" />
          <PipelineSegment label="Done" count={pipeline.done} total={stats.total} className="bg-primary/30" />
        </div>
        <div className="flex items-center gap-4 mt-2 flex-wrap">
          <PipelineLegend label="New" count={pipeline.untriaged} className="bg-muted" />
          <PipelineLegend label="Decision" count={pipeline.yourDecision} className="bg-chart-4/40" />
          <PipelineLegend label="Working" count={pipeline.agentWorking} className="bg-chart-2/40" />
          <PipelineLegend label="Testing" count={pipeline.testing} className="bg-chart-3/40" />
          <PipelineLegend label="Review" count={pipeline.userReview} className="bg-chart-5/40" />
          <PipelineLegend label="Done" count={pipeline.done} className="bg-primary/30" />
        </div>
      </div>

      {/* Bottom grid: Type distribution + special counts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Type distribution */}
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">By Type</h3>
          <div className="space-y-2">
            {Object.entries(stats.byType).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between">
                <span className="text-sm capitalize text-muted-foreground">{type}</span>
                <span className="text-sm font-medium text-foreground">{count}</span>
              </div>
            ))}
            {Object.keys(stats.byType).length === 0 && (
              <p className="text-xs text-muted-foreground">No tickets yet.</p>
            )}
          </div>
        </div>

        {/* Special counts */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground mb-3">Action Items</h3>
          <ActionItem icon={AlertTriangle} label="Needing Rework" count={stats.needingRework} warn />
          <ActionItem icon={CalendarClock} label="Follow-ups Due" count={stats.followUpsDue} warn />
          <ActionItem icon={Star} label="Decisions Pending" count={stats.needingDecision} warn />
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
  warn,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-4 h-4", warn ? "text-destructive" : highlight ? "text-primary" : "text-muted-foreground")} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", warn ? "text-destructive" : "text-foreground")}>{value}</p>
    </div>
  );
}

function PipelineSegment({ label, count, total, className }: { label: string; count: number; total: number; className: string }) {
  if (total === 0 || count === 0) return null;
  const pct = Math.max(2, (count / total) * 100); // min 2% for visibility
  return (
    <div
      className={cn("flex items-center justify-center text-[10px] font-medium text-foreground/70 transition-all", className)}
      style={{ width: `${pct}%` }}
      title={`${label}: ${count}`}
    >
      {pct > 8 ? count : ""}
    </div>
  );
}

function PipelineLegend({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("w-2.5 h-2.5 rounded-sm", className)} />
      <span className="text-xs text-muted-foreground">{label} ({count})</span>
    </div>
  );
}

function ActionItem({ icon: Icon, label, count, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; count: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon className={cn("w-4 h-4", warn && count > 0 ? "text-chart-4" : "text-muted-foreground")} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className={cn("text-sm font-medium", warn && count > 0 ? "text-chart-4" : "text-foreground")}>{count}</span>
    </div>
  );
}
