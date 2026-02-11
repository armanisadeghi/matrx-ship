"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bug,
  Lightbulb,
  MessageSquare,
  ListTodo,
  Sparkles,
  Search,
  Send,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TICKET_TYPES = [
  { value: "bug", label: "Bug Report", icon: Bug, description: "Something isn't working correctly" },
  { value: "feature", label: "Feature Request", icon: Lightbulb, description: "Suggest a new feature or improvement" },
  { value: "suggestion", label: "Suggestion", icon: MessageSquare, description: "General feedback or idea" },
  { value: "task", label: "Task", icon: ListTodo, description: "A specific task to complete" },
  { value: "enhancement", label: "Enhancement", icon: Sparkles, description: "Improve existing functionality" },
];

export default function PortalPage() {
  const router = useRouter();
  const [view, setView] = useState<"home" | "submit">("home");
  const [lookupNumber, setLookupNumber] = useState("");
  const [selectedType, setSelectedType] = useState("");

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLookup = () => {
    const num = lookupNumber.replace(/\D/g, "");
    if (!num) {
      toast.error("Enter a ticket number");
      return;
    }
    router.push(`/portal/tickets/${num}`);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim() || !selectedType) {
      toast.error("Please fill in all required fields");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/tickets/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          ticket_type: selectedType,
          priority: priority || undefined,
          reporter_email: email || undefined,
          reporter_name: name || undefined,
          reporter_id: email || `anon-${Date.now()}`,
          source: "portal",
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error ?? "Failed to submit");
      }

      const data = await res.json();
      toast.success(`Ticket T-${data.ticket_number} created!`);
      router.push(`/portal/tickets/${data.ticket_number}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit ticket");
    } finally {
      setSubmitting(false);
    }
  };

  if (view === "submit") {
    return (
      <div className="space-y-6">
        <div>
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setView("home")}>
            &larr; Back
          </button>
          <h1 className="text-2xl font-bold text-foreground mt-2">Submit a Ticket</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tell us what you need help with and we&apos;ll get back to you.
          </p>
        </div>

        {/* Type selection */}
        {!selectedType ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TICKET_TYPES.map((type) => (
              <button
                key={type.value}
                className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl hover:border-primary/40 transition-colors text-left"
                onClick={() => setSelectedType(type.value)}
              >
                <type.icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">{type.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{type.description}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Selected type indicator */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Type:</span>
              <span className="text-sm font-medium text-foreground capitalize">{selectedType}</span>
              <button className="text-xs text-primary hover:underline ml-2" onClick={() => setSelectedType("")}>
                Change
              </button>
            </div>

            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                placeholder="Brief summary of the issue"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                placeholder="Provide as much detail as possible..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1"
                rows={6}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Your Name</Label>
                <Input
                  id="name"
                  placeholder="Optional"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="For follow-up notifications"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Auto-determined if not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Submit Ticket
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Support Portal</h1>
        <p className="text-muted-foreground mt-2">
          Submit a new ticket or track an existing one.
        </p>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          className="flex flex-col items-center gap-3 p-8 bg-card border border-border rounded-2xl hover:border-primary/40 transition-colors"
          onClick={() => setView("submit")}
        >
          <Send className="w-8 h-8 text-primary" />
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">Submit a Ticket</p>
            <p className="text-sm text-muted-foreground mt-1">Report a bug, request a feature, or ask a question</p>
          </div>
        </button>

        <div className="flex flex-col items-center gap-3 p-8 bg-card border border-border rounded-2xl">
          <Search className="w-8 h-8 text-primary" />
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">Track a Ticket</p>
            <p className="text-sm text-muted-foreground mt-1">Check the status of your existing ticket</p>
          </div>
          <div className="flex items-center gap-2 w-full max-w-xs mt-2">
            <Input
              placeholder="T-123"
              value={lookupNumber}
              onChange={(e) => setLookupNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLookup();
              }}
              className="text-center"
            />
            <Button size="sm" onClick={handleLookup}>
              Go
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
