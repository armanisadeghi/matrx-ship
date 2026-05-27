"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  Layers,
  Terminal,
  Key,
  History,
  Monitor,
  Database,
  Server,
  FileText,
  TableProperties,
  ExternalLink,
  Boxes,
  Activity,
  Cloud,
  KeyRound,
  ScrollText,
  ShieldAlert,
  ArrowUpCircle,
  KeySquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LoginScreen } from "@/components/admin/login-screen";
import { SandboxImageBanner } from "@/components/admin/sandbox-image-banner";
import { FleetHealthBanner } from "@/components/admin/fleet-health-banner";
import { AdminShell, type NavGroup, type NavItem } from "@matrx/admin-ui/components/admin-shell";
import { Badge } from "@matrx/admin-ui/ui/badge";

// Nav grouped by the layers in UI_FLOW.md: Fleet (the things we run) → Access &
// Ops (super-admin power tools) → Monitoring → Build → Reference. The word
// "instance" is retired: a deployed app is an "App", a sandbox is a "Sandbox".
const navGroups: NavGroup[] = [
  {
    label: "Fleet",
    items: [
      { id: "servers", href: "/servers", label: "Servers", icon: Server },
      { id: "versions", href: "/versions", label: "Versions & Updates", icon: ArrowUpCircle },
      { id: "instances", href: "/instances", label: "Apps", icon: Layers },
      { id: "orchestrator-sandboxes", href: "/orchestrator-sandboxes", label: "Sandboxes", icon: Boxes },
      { id: "sandboxes", href: "/sandboxes", label: "Starter pool", icon: Terminal },
    ],
  },
  {
    label: "Access & Ops",
    items: [
      { id: "terminal", href: "/terminal", label: "Terminal", icon: Terminal },
      { id: "agent-access", href: "/agent-access", label: "Agent Access", icon: KeyRound },
      { id: "hosts", href: "/hosts", label: "Hosts (EC2)", icon: Cloud },
      { id: "secrets", href: "/secrets", label: "Secrets", icon: KeySquare },
      { id: "tokens", href: "/tokens", label: "Tokens", icon: Key },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { id: "activity", href: "/activity", label: "Activity", icon: ScrollText },
      { id: "fleet-health", href: "/fleet-health", label: "Fleet Health", icon: Activity },
      { id: "system", href: "/system", label: "System", icon: Monitor },
      { id: "db-health", href: "/db-health", label: "DB Health", icon: Database },
      { id: "infrastructure", href: "/infrastructure", label: "Infrastructure", icon: Server },
    ],
  },
  {
    label: "Build",
    items: [
      { id: "builds", href: "/builds", label: "Builds", icon: History },
    ],
  },
  {
    label: "Admin Tools",
    items: [
      { id: "directus", href: "https://directus.app.matrxserver.com", label: "Directus CMS", icon: Database, external: true },
      { id: "nocodb", href: "https://nocodb.app.matrxserver.com", label: "NocoDB", icon: TableProperties, external: true },
    ],
  },
  {
    label: "Reference",
    items: [
      { id: "docs", href: "/docs", label: "Documentation", icon: FileText },
    ],
  },
];

// Nav items that expose envs, tokens, or live access — restricted to superadmins
// (admins.level == super_admin, or break-glass operator tokens). Developer and
// Senior Admin don't see these. The backend enforces the same gate.
const SUPERADMIN_ONLY = new Set(["hosts", "terminal", "agent-access", "tokens", "secrets"]);

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { authed, loading, role, isSuperadmin, logout } = useAuth();
  const pathname = usePathname();

  const visibleNavGroups = isSuperadmin
    ? navGroups
    : navGroups
        .map((g) => ({ ...g, items: g.items.filter((it) => !SUPERADMIN_ONLY.has(it.id)) }))
        .filter((g) => g.items.length > 0);

  // Direct-URL guard: the first path segment maps to a nav id.
  const needsSuperadmin = SUPERADMIN_ONLY.has(pathname.split("/")[1] || "");

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen />;
  }

  return (
    <AdminShell
      config={{
        appName: "Server Manager",
        appDescription: "Matrx Infrastructure",
        logoSrc: "/admin/matrx-icon-purple.svg",
        navGroups: visibleNavGroups,
        version: "v0.2.0",
      }}
      activePath={pathname}
      onNavigate={() => {}}
      role={role}
      onLogout={logout}
      renderNavLink={(item: NavItem, isActive: boolean, onClick: () => void) => {
        const isExternal = item.external;
        const linkClasses = cn(
          "flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        );

        if (isExternal) {
          return (
            <a
              key={item.id}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClasses}
            >
              <item.icon className="w-4.5 h-4.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">{item.label}</span>
              <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground" />
            </a>
          );
        }

        return (
          <Link
            key={item.id}
            href={item.href}
            onClick={onClick}
            className={linkClasses}
          >
            <item.icon
              className={cn(
                "w-4.5 h-4.5 shrink-0",
                isActive ? "text-sidebar-primary" : "text-muted-foreground",
              )}
            />
            <span className="flex-1 text-left">{item.label}</span>
            {item.badge && (
              <Badge variant="default" className="text-[10px] h-5 px-1.5">
                {item.badge}
              </Badge>
            )}
          </Link>
        );
      }}
    >
      <FleetHealthBanner />
      <SandboxImageBanner />
      {needsSuperadmin && !isSuperadmin ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <ShieldAlert className="size-10 text-amber-500" />
          <h2 className="text-lg font-semibold">Super-admin only</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            This area exposes environment variables, tokens, or live access to infrastructure, so it&apos;s restricted to super-admins. Your role is <span className="font-mono">{role}</span>.
          </p>
        </div>
      ) : (
        children
      )}
    </AdminShell>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardContent>{children}</DashboardContent>
    </AuthProvider>
  );
}
