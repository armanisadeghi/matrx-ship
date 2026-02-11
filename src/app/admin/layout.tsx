"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  GitBranch,
  BarChart3,
  Rocket,
  Database,
  TerminalSquare,
  ScrollText,
  HeartPulse,
  KeyRound,
  Settings,
  Bug,
  Bell,
  ClipboardList,
  Package,
  Columns3,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";

import { ScrollArea } from "@/components/ui/scroll-area";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  soon?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Main",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { href: "/admin/versions", label: "Versions", icon: GitBranch },
      { href: "/admin/deployments", label: "Deployments", icon: Rocket },
      { href: "/admin/stats", label: "Statistics", icon: BarChart3 },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/admin/database", label: "Tables", icon: Database },
      { href: "/admin/database/schema", label: "Schema", icon: Columns3 },
      { href: "/admin/database/migrations", label: "Migrations", icon: History },
      { href: "/admin/database/query", label: "SQL Console", icon: TerminalSquare },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { href: "/admin/logs", label: "Logs", icon: ScrollText },
      { href: "/admin/health", label: "Health", icon: HeartPulse },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/admin/api-keys", label: "API Keys", icon: KeyRound },
      { href: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "Coming Soon",
    items: [
      { href: "/admin/bug-reports", label: "Bug Reports", icon: Bug, soon: true },
      { href: "/admin/alerts", label: "Alerts", icon: Bell, soon: true },
      { href: "/admin/audit-trail", label: "Audit Trail", icon: ClipboardList, soon: true },
    ],
  },
];

// Collect all nav hrefs to determine the best active match
const allNavHrefs = navGroups.flatMap((g) => g.items.map((i) => i.href));

function getIsActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  if (pathname === item.href) return true;
  if (!pathname.startsWith(item.href)) return false;
  // For prefix matches, only activate if no other nav item is a more specific match
  const moreSpecific = allNavHrefs.some(
    (href) => href !== item.href && href.startsWith(item.href) && pathname.startsWith(href),
  );
  return !moreSpecific;
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh flex">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-sidebar-border">
          <Link href="/admin" className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-ship-500 to-ship-700 rounded-xl flex items-center justify-center">
              <Package className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-sidebar-foreground leading-tight">
                Matrx Ship
              </h1>
              <p className="text-xs text-muted-foreground leading-tight">
                {process.env.NEXT_PUBLIC_PROJECT_NAME || "Dev Portal"}
              </p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="px-3 py-4 space-y-6">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = getIsActive(pathname, item);

                    return (
                      <Link
                        key={item.href}
                        href={item.soon ? "#" : item.href}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                          isActive && !item.soon
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : item.soon
                              ? "text-muted-foreground/60 cursor-default"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                        onClick={item.soon ? (e) => e.preventDefault() : undefined}
                      >
                        <item.icon
                          className={cn(
                            "w-4.5 h-4.5 shrink-0",
                            isActive && !item.soon
                              ? "text-sidebar-primary"
                              : item.soon
                                ? "text-muted-foreground/40"
                                : "text-muted-foreground",
                          )}
                        />
                        <span className="flex-1">{item.label}</span>
                        {item.soon && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                            Soon
                          </Badge>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-sidebar-border space-y-3">
          <ThemeToggle />
          <p className="text-xs text-muted-foreground">Matrx Ship v0.1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
