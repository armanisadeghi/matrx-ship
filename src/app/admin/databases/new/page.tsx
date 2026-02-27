"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Database,
  Loader2,
  CheckCircle2,
  BookOpen,
  Users,
  ShoppingCart,
  FileText,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  tables: string[];
}

const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank Database",
    description: "Start from scratch with an empty database",
    icon: <Database className="w-5 h-5" />,
    tables: [],
  },
  {
    id: "flashcards",
    name: "Flashcard App",
    description: "Users, decks, cards, and study progress tracking",
    icon: <BookOpen className="w-5 h-5" />,
    tables: ["users", "decks", "cards", "study_sessions", "progress"],
  },
  {
    id: "crm",
    name: "CRM",
    description: "Contacts, companies, deals, and activity tracking",
    icon: <Users className="w-5 h-5" />,
    tables: ["contacts", "companies", "deals", "activities", "notes"],
  },
  {
    id: "ecommerce",
    name: "E-Commerce",
    description: "Products, orders, customers, and inventory",
    icon: <ShoppingCart className="w-5 h-5" />,
    tables: [
      "customers",
      "products",
      "categories",
      "orders",
      "order_items",
      "inventory",
    ],
  },
  {
    id: "content",
    name: "Content / Blog",
    description: "Posts, authors, categories, tags, and comments",
    icon: <FileText className="w-5 h-5" />,
    tables: ["authors", "posts", "categories", "tags", "comments"],
  },
];

export default function NewDatabasePage() {
  const router = useRouter();
  const [step, setStep] = useState<"template" | "configure" | "creating">(
    "template",
  );
  const [selectedTemplate, setSelectedTemplate] = useState<Template>(
    TEMPLATES[0],
  );
  const [displayName, setDisplayName] = useState("");
  const [databaseName, setDatabaseName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const handleDisplayNameChange = (value: string) => {
    setDisplayName(value);
    // Auto-generate database name from display name
    const dbName = value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "_")
      .replace(/^[^a-z]/, "db_$&");
    setDatabaseName(dbName || "");
  };

  const handleCreate = async () => {
    if (!displayName.trim() || !databaseName.trim()) {
      setError("Name is required");
      return;
    }

    setStep("creating");
    setError(null);

    try {
      const res = await fetch("/api/admin/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          database_name: databaseName,
          display_name: displayName,
          description: description || null,
          template: selectedTemplate.id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create database");
      }

      setCreated(true);
      // Navigate back after a brief pause
      setTimeout(() => router.push("/admin/databases"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setStep("configure");
    }
  };

  if (created) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Database Created
          </h2>
          <p className="text-muted-foreground mb-2">
            <span className="font-mono font-semibold">{databaseName}</span> is
            ready to use.
          </p>
          <p className="text-sm text-muted-foreground">
            Redirecting to databases...
          </p>
        </div>
      </div>
    );
  }

  if (step === "creating") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Creating Database
          </h2>
          <p className="text-muted-foreground">
            Setting up <span className="font-mono">{databaseName}</span>
            {selectedTemplate.id !== "blank" && (
              <>
                {" "}
                with the{" "}
                <span className="font-semibold">{selectedTemplate.name}</span>{" "}
                template
              </>
            )}
            ...
          </p>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Create Database"
      description="Set up a new database for your application"
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/databases">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
      }
    >
      {step === "template" && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Choose a Template
            </h3>
            <p className="text-xs text-muted-foreground">
              Start with a pre-built schema or create a blank database to design
              your own.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => setSelectedTemplate(template)}
                className={cn(
                  "text-left bg-card rounded-xl border shadow-sm p-5 transition-all hover:shadow-md",
                  selectedTemplate.id === template.id
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40",
                )}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center",
                      selectedTemplate.id === template.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {template.icon}
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm text-foreground">
                      {template.name}
                    </h4>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {template.description}
                </p>
                {template.tables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {template.tables.map((t) => (
                      <Badge
                        key={t}
                        variant="secondary"
                        className="text-[10px] font-mono"
                      >
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setStep("configure")}>
              <Sparkles className="w-4 h-4 mr-2" />
              Continue with {selectedTemplate.name}
            </Button>
          </div>
        </div>
      )}

      {step === "configure" && (
        <div className="max-w-lg space-y-6">
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                {selectedTemplate.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {selectedTemplate.name}
                </p>
                <button
                  onClick={() => setStep("template")}
                  className="text-xs text-primary hover:underline"
                >
                  Change template
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Database Display Name
                </label>
                <Input
                  value={displayName}
                  onChange={(e) => handleDisplayNameChange(e.target.value)}
                  placeholder="My Flashcard App"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Database Name
                </label>
                <Input
                  value={databaseName}
                  onChange={(e) =>
                    setDatabaseName(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, ""),
                    )
                  }
                  placeholder="my_flashcard_app"
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Lowercase letters, numbers, and underscores only
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Description{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Database for storing flashcard data and user progress"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep("template")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!displayName.trim() || !databaseName.trim()}
            >
              <Database className="w-4 h-4 mr-2" />
              Create Database
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
