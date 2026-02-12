"use client";

import { Loader2 } from "lucide-react";
import { DeployLayout } from "@/components/deploy-layout";
import { LoginScreen } from "@/components/deploy/login-screen";
import { AuthProvider, useAuth } from "@/lib/auth-context";

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { authed, loading, logout, api } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen onLogin={() => window.location.reload()} api={api} />;
  }

  return (
    <DeployLayout onLogout={logout}>
      {children}
    </DeployLayout>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DashboardContent>{children}</DashboardContent>
    </AuthProvider>
  );
}
