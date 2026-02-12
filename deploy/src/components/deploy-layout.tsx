"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Rocket,
  History,
  Server,
  LayoutDashboard,
  Settings,
  FileText,
  Shield,
  Container,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminShell, type NavGroup, type NavItem } from "@matrx/admin-ui/components/admin-shell";
import { Badge } from "@matrx/admin-ui/ui/badge";

const navGroups: NavGroup[] = [
  {
    label: "Server Manager",
    items: [
      { id: "manager", href: "/manager", label: "Manager Control", icon: Settings, badge: "Primary" },
    ],
  },
  {
    label: "Deployment",
    items: [
      { id: "deploy", href: "/deploy", label: "Deploy", icon: Rocket },
      { id: "history", href: "/history", label: "Build History", icon: History },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { id: "instances", href: "/instances", label: "Instances", icon: LayoutDashboard },
      { id: "infrastructure", href: "/infrastructure", label: "Infrastructure", icon: Server },
    ],
  },
  {
    label: "Emergency",
    items: [
      { id: "docker", href: "/docker", label: "Docker Control", icon: Container },
      { id: "emergency", href: "/emergency", label: "Emergency Access", icon: Shield },
    ],
  },
  {
    label: "Reference",
    items: [
      { id: "docs", href: "/docs", label: "Documentation", icon: FileText },
    ],
  },
];

// Keep legacy type for backward compat
export type DeployView =
  | "deploy"
  | "history"
  | "system"
  | "services"
  | "manager"
  | "instances"
  | "infrastructure"
  | "docs";

interface DeployLayoutProps {
  onRefresh?: () => void;
  onLogout?: () => void;
  children: React.ReactNode;
  activeView?: DeployView;
  onNavigate?: (view: DeployView) => void;
}

export function DeployLayout({
  onRefresh,
  onLogout,
  children,
}: DeployLayoutProps) {
  const pathname = usePathname();

  return (
    <AdminShell
      config={{
        appName: "Matrx Deploy",
        appDescription: "Infrastructure Management",
        logoSrc: "/matrx-icon-green.svg",
        navGroups,
        version: "v0.2.0",
      }}
      activePath={pathname}
      onNavigate={() => {}}
      role="admin"
      onRefresh={onRefresh}
      onLogout={onLogout}
      renderNavLink={(item: NavItem, isActive: boolean, onClick: () => void) => (
        <Link
          key={item.id}
          href={item.href}
          onClick={onClick}
          className={cn(
            "flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <item.icon
            className={cn(
              "w-4.5 h-4.5 shrink-0",
              isActive
                ? "text-sidebar-primary"
                : "text-muted-foreground",
            )}
          />
          <span className="flex-1 text-left">{item.label}</span>
          {item.badge && (
            <Badge variant="default" className="text-[10px] h-5 px-1.5">
              {item.badge}
            </Badge>
          )}
        </Link>
      )}
    >
      {children}
    </AdminShell>
  );
}
