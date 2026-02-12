"use client";

import { useState } from "react";
import {
  Shield, Terminal, Container, FileText,
  ExternalLink, AlertTriangle, Server, Globe,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Button } from "@matrx/admin-ui/ui/button";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";

export default function EmergencyPage() {
  const { api } = useAuth();
  const [execOutput, setExecOutput] = useState<string>("");
  const [execCmd, setExecCmd] = useState<string>("");
  const [executing, setExecuting] = useState(false);

  async function executeCommand() {
    if (!execCmd.trim()) return;
    setExecuting(true);
    try {
      const result = await api("/api/exec", {
        method: "POST",
        body: JSON.stringify({ command: execCmd }),
      });
      setExecOutput((result as { output?: string }).output || "Command returned no output");
    } catch (e) {
      setExecOutput(`Error: ${(e as Error).message}`);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <PageShell
      title="Emergency Access"
      description="Direct server access for when the Manager is down"
      icon={Shield}
    >
      {/* Warning */}
      <Card className="border-warning/50 bg-warning/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-warning">Emergency Tools</p>
              <p className="text-sm text-muted-foreground mt-1">
                These tools provide direct access to Docker and the server. Use when the Server Manager
                is unreachable and you need to diagnose or recover services. For normal operations,
                use the <Link href="/admin" className="text-primary hover:underline">Server Manager</Link>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link href="/docker">
          <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <Container className="size-5 text-primary" />
                <h3 className="font-semibold">Docker Control</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Start, stop, restart, and view logs for any Docker container on the server.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/infrastructure">
          <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <Server className="size-5 text-primary" />
                <h3 className="font-semibold">Infrastructure Status</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                View system resources, service health, and container status at a glance.
              </p>
            </CardContent>
          </Card>
        </Link>

        <a href="https://traefik.dev.codematrx.com" target="_blank" rel="noopener">
          <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <Globe className="size-5 text-primary" />
                <h3 className="font-semibold flex items-center gap-2">
                  Traefik Dashboard <ExternalLink className="size-3" />
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Inspect routing rules, SSL certificates, and service discovery.
              </p>
            </CardContent>
          </Card>
        </a>
      </div>

      {/* Quick command execution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="size-4" /> Quick Command
          </CardTitle>
          <CardDescription>
            Execute a command on the server via the Deploy API. Limited to read-only and Docker commands.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={execCmd}
              onChange={(e) => setExecCmd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && executeCommand()}
              placeholder="e.g. docker ps -a, docker logs matrx-manager --tail 50"
              className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
            <Button onClick={executeCommand} disabled={executing || !execCmd.trim()}>
              {executing ? "Running..." : "Execute"}
            </Button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {["docker ps -a", "docker stats --no-stream", "docker system df", "df -h", "free -h", "uptime"].map((cmd) => (
              <Badge
                key={cmd}
                variant="outline"
                className="cursor-pointer hover:bg-muted transition-colors"
                onClick={() => { setExecCmd(cmd); }}
              >
                {cmd}
              </Badge>
            ))}
          </div>
          {execOutput && (
            <pre className="bg-zinc-950 text-zinc-300 rounded-lg p-4 font-mono text-xs max-h-96 overflow-auto whitespace-pre-wrap">
              {execOutput}
            </pre>
          )}
        </CardContent>
      </Card>

      {/* Service restart checklist */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="size-4" /> Recovery Checklist
          </CardTitle>
          <CardDescription>
            Steps to recover when the Server Manager is down
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Check if the Manager container is running: <code className="bg-muted px-1 py-0.5 rounded text-xs">docker ps -a | grep manager</code></li>
            <li>If stopped, restart it: <code className="bg-muted px-1 py-0.5 rounded text-xs">docker start matrx-manager</code></li>
            <li>If crashing, check logs: <code className="bg-muted px-1 py-0.5 rounded text-xs">docker logs matrx-manager --tail 100</code></li>
            <li>If image is corrupted, rebuild from Deploy: use the "Rebuild Manager" button on the Deploy page</li>
            <li>If Traefik is down, restart it: <code className="bg-muted px-1 py-0.5 rounded text-xs">docker start traefik</code></li>
            <li>If PostgreSQL is down: <code className="bg-muted px-1 py-0.5 rounded text-xs">docker start postgres</code></li>
          </ol>
        </CardContent>
      </Card>
    </PageShell>
  );
}
