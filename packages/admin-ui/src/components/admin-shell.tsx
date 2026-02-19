"use client";

import { useState } from "react";
import {
  RefreshCw,
  LogOut,
  Menu,
  ShieldCheck,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";
import { ThemeToggle } from "./theme-toggle";

/* ─── Public types ─── */

export interface NavItem {
  id: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  external?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface AdminShellConfig {
  appName: string;
  appDescription: string;
  /** Path to the colored logo SVG (e.g. "/matrx-icon-green.svg") */
  logoSrc: string;
  navGroups: NavGroup[];
  version: string;
}

interface AdminShellProps {
  config: AdminShellConfig;
  /** Current active path or view id for highlighting */
  activePath: string;
  /** Called when a nav item is clicked. Receives the item href. */
  onNavigate: (href: string) => void;
  /** User role for the badge */
  role?: string;
  onRefresh?: () => void;
  onLogout?: () => void;
  /** Render prop for custom nav link elements (e.g. Next.js <Link>) */
  renderNavLink?: (item: NavItem, isActive: boolean, onClick: () => void) => React.ReactNode;
  children: React.ReactNode;
}

/* ─── Sidebar content (shared between desktop & mobile) ─── */

function SidebarContent({
  config,
  activePath,
  onNavigate,
  role,
  onRefresh,
  onLogout,
  onClose,
  renderNavLink,
}: Omit<AdminShellProps, "children"> & { onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      {/* Header — pinned at top */}
      <div className="px-5 py-4 border-b border-sidebar-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={config.logoSrc}
              alt={`${config.appName} logo`}
              className="w-9 h-9 object-contain"
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-sidebar-foreground leading-tight truncate">
              {config.appName}
            </h1>
            <p className="text-xs text-muted-foreground leading-tight truncate">
              {config.appDescription}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation — independently scrollable */}
      <ScrollArea className="flex-1 min-h-0">
        <nav className="px-3 py-4 space-y-6">
          {config.navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive =
                    activePath === item.href ||
                    activePath === item.id ||
                    (item.href !== "/" && activePath.startsWith(item.href));

                  if (renderNavLink) {
                    return renderNavLink(item, isActive, () => onClose?.());
                  }

                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onNavigate(item.href);
                        onClose?.();
                      }}
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
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Footer — pinned at bottom, never scrolls */}
      <div className="px-4 py-4 border-t border-sidebar-border space-y-3 shrink-0 mt-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <Badge variant={role === "admin" ? "default" : "secondary"} className="text-xs">
              {role || "admin"}
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
        <p className="text-xs text-muted-foreground">{config.appName} {config.version}</p>
      </div>
    </div>
  );
}

/* ─── Main shell ─── */

export function AdminShell({
  config,
  activePath,
  onNavigate,
  role,
  onRefresh,
  onLogout,
  renderNavLink,
  children,
}: AdminShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarProps = {
    config,
    activePath,
    onNavigate,
    role,
    onRefresh,
    onLogout,
    renderNavLink,
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* ── Mobile sheet sidebar ── */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent
            {...sidebarProps}
            onClose={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* ── Right column: mobile header + main content ── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Mobile top bar — only visible below md */}
        <header className="flex md:hidden items-center justify-between border-b border-border bg-sidebar px-4 py-3 shrink-0">
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
              <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={config.logoSrc}
                  alt={`${config.appName} logo`}
                  className="w-7 h-7 object-contain"
                />
              </div>
              <span className="font-semibold text-sm">{config.appName}</span>
            </div>
          </div>
          <Badge variant={role === "admin" ? "default" : "secondary"} className="text-xs">
            {role || "admin"}
          </Badge>
        </header>

        {/* Main content — scrolls independently */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
