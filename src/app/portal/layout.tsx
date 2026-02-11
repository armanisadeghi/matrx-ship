import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";

export const metadata = {
  title: "Support Portal - Matrx Ship",
  description: "Submit and track support tickets",
};

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/portal" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary/60 rounded-lg flex items-center justify-center">
              <span className="text-sm font-bold text-primary-foreground">M</span>
            </div>
            <span className="text-lg font-semibold text-foreground">Support</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 py-8">{children}</div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-xs text-muted-foreground">Powered by Matrx Ship</p>
        </div>
      </footer>
    </div>
  );
}
