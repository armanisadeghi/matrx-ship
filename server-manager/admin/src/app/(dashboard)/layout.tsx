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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LoginScreen } from "@/components/admin/login-screen";
import { AdminShell, type NavGroup, type NavItem } from "@matrx/admin-ui/components/admin-shell";
import { Badge } from "@matrx/admin-ui/ui/badge";

const navGroups: NavGroup[] = [
  {
    label: "Main",
    items: [
      { id: "instances", href: "/instances", label: "Instances", icon: Layers },
      { id: "sandboxes", href: "/sandboxes", label: "Sandboxes", icon: Terminal },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "builds", href: "/builds", label: "Builds", icon: History },
      { id: "tokens", href: "/tokens", label: "Tokens", icon: Key },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { id: "system", href: "/system", label: "System", icon: Monitor },
      { id: "db-health", href: "/db-health", label: "DB Health", icon: Database },
      { id: "infrastructure", href: "/infrastructure", label: "Infrastructure", icon: Server },
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

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { authed, loading, role, logout } = useAuth();
  const pathname = usePathname();

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
        navGroups,
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
      {children}
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
