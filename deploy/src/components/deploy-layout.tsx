"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Rocket,
  History,
  Server,
  LayoutDashboard,
  RefreshCw,
  LogOut,
  Menu,
  ShieldCheck,
  Settings,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";

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

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Server Manager",
    items: [
      { href: "/manager", label: "Manager Control", icon: Settings, badge: "primary" },
    ],
  },
  {
    label: "Deployment",
    items: [
      { href: "/deploy", label: "Deploy", icon: Rocket },
      { href: "/history", label: "Build History", icon: History },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/instances", label: "Instances", icon: LayoutDashboard },
      { href: "/infrastructure", label: "Infrastructure", icon: Server },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/docs", label: "Documentation", icon: FileText },
    ],
  },
];

interface DeployLayoutProps {
  onRefresh?: () => void;
  onLogout?: () => void;
  children: React.ReactNode;
  // Legacy props — keep for backward compat with existing pages
  activeView?: DeployView;
  onNavigate?: (view: DeployView) => void;
}

function SidebarContent({
  onRefresh,
  onLogout,
  onClose,
}: {
  onRefresh?: () => void;
  onLogout?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-ship-500 to-ship-700 rounded-xl flex items-center justify-center">
            <Rocket className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-sidebar-foreground leading-tight">
              Matrx Deploy
            </h1>
            <p className="text-xs text-muted-foreground leading-tight">
              Infrastructure Management
            </p>
          </div>
        </div>
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
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => onClose?.()}
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
                      {item.badge === "primary" && (
                        <Badge variant="default" className="text-[10px] h-5 px-1.5">
                          Primary
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <Badge variant="default" className="text-xs">
              admin
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                className="h-7 w-7 p-0"
                title="Refresh"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            )}
            {onLogout && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onLogout}
                className="h-7 w-7 p-0"
                title="Logout"
              >
                <LogOut className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        <ThemeToggle />
        <p className="text-xs text-muted-foreground">Matrx Deploy v0.2.0</p>
      </div>
    </div>
  );
}

export function DeployLayout({
  onRefresh,
  onLogout,
  children,
}: DeployLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-sidebar border-r border-sidebar-border flex-col shrink-0">
        <SidebarContent
          onRefresh={onRefresh}
          onLogout={onLogout}
        />
      </aside>

      {/* Mobile top bar + sheet */}
      <div className="flex flex-1 flex-col md:hidden">
        <header className="flex items-center justify-between border-b bg-sidebar px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-gradient-to-br from-ship-500 to-ship-700 rounded-lg flex items-center justify-center">
                <Rocket className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-sm">Matrx Deploy</span>
            </div>
          </div>
          <Badge variant="default" className="text-xs">
            admin
          </Badge>
        </header>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent
              onRefresh={onRefresh}
              onLogout={onLogout}
              onClose={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>

        {/* Mobile main content */}
        <main className="flex-1 overflow-auto bg-background">
          <div className="max-w-6xl mx-auto px-4 py-6">{children}</div>
        </main>
      </div>

      {/* Desktop main content */}
      <main className="hidden md:block flex-1 overflow-auto bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
