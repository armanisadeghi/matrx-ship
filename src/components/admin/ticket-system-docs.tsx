
import {
    Book,
    Code2,
    Cpu,
    Globe,
    Layout,
    Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
// import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

function CodeBlock({ language, code }: { language: string; code: string }) {
    // Basic code block as fallback
    return (
        <pre className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 overflow-x-auto text-sm font-mono text-zinc-50 my-4">
            <code className={`language-${language}`}>{code}</code>
        </pre>
    )
}

export function TicketSystemDocs() {
    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-10">
            <div className="flex bg-muted/30 p-6 rounded-xl border border-border/50 gap-4 mb-8">
                <Book className="w-8 h-8 text-primary shrink-0 mt-1" />
                <div>
                    <h2 className="text-xl font-semibold mb-2">Matrx Ship Ticket System Guide</h2>
                    <p className="text-muted-foreground leading-relaxed">
                        The Matrx Ship ticketing system is designed to be consumed by multiple interfaces:
                        human users via the Portal, developers via the SDK,AI agents via MCP, and admins via this dashboard.
                    </p>
                </div>
            </div>

            <Tabs defaultValue="sdk" className="space-y-6">
                <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
                    <TabsTrigger value="sdk">React SDK</TabsTrigger>
                    <TabsTrigger value="mcp">AI Agents (MCP)</TabsTrigger>
                    <TabsTrigger value="api">REST API</TabsTrigger>
                </TabsList>

                {/* --- SDK Documentation --- */}
                <TabsContent value="sdk" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Layout className="w-5 h-5 text-primary" />
                                <CardTitle>React Integration SDK</CardTitle>
                            </div>
                            <CardDescription>
                                Embed the ticketing widget into any React application.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div>
                                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                    <Terminal className="w-4 h-4" />
                                    Installation
                                </h3>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Copy the <code>packages/ticket-widget</code> directory to your project or install it if published.
                                </p>
                                <CodeBlock language="bash" code="pnpm add @matrx/ticket-widget" />
                            </div>

                            <div>
                                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                    <Code2 className="w-4 h-4" />
                                    Usage
                                </h3>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Wrap your app in the provider and use the components.
                                </p>
                                <CodeBlock language="tsx" code={`import { TicketProvider, TicketButton, TicketTracker } from "@matrx/ticket-widget";

export default function App() {
  return (
    <TicketProvider 
      shipUrl="http://localhost:3000" 
      reporterToken="your-reporter-token" // Optional for public submission
    >
      {/* Your app content */}
      
      {/* Floating feedback button */}
      <TicketButton />
      
      {/* Or embed a tracker */}
      <TicketTracker />
    </TicketProvider>
  );
}`} />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* --- MCP Documentation --- */}
                <TabsContent value="mcp" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Cpu className="w-5 h-5 text-primary" />
                                <CardTitle>Model Context Protocol (MCP)</CardTitle>
                            </div>
                            <CardDescription>
                                Tools for AI agents (Claude, Cursor, etc.) to read and manage tickets.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div>
                                <h3 className="text-sm font-semibold mb-2">Endpoint Configuration</h3>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Add this SSE endpoint to your MCP client configuration.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 rounded-lg border bg-card">
                                        <span className="text-xs font-mono text-muted-foreground block mb-1">URL</span>
                                        <code className="text-sm font-medium">http://localhost:3000/api/mcp</code>
                                    </div>
                                    <div className="p-4 rounded-lg border bg-card">
                                        <span className="text-xs font-mono text-muted-foreground block mb-1">Authorization</span>
                                        <code className="text-sm font-medium">Bearer [API_KEY]</code>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-semibold mb-2">Available Tools</h3>
                                <div className="rounded-md border divide-y">
                                    <div className="p-3 text-sm flex justify-between items-center">
                                        <code className="font-mono text-primary">get_ticket_timeline</code>
                                        <span className="text-muted-foreground text-xs">Get full chronological history</span>
                                    </div>
                                    <div className="p-3 text-sm flex justify-between items-center">
                                        <code className="font-mono text-primary">submit_ticket</code>
                                        <span className="text-muted-foreground text-xs">Create new ticket</span>
                                    </div>
                                    <div className="p-3 text-sm flex justify-between items-center">
                                        <code className="font-mono text-primary">triage_ticket</code>
                                        <span className="text-muted-foreground text-xs">Add AI analysis & metadata</span>
                                    </div>
                                    <div className="p-3 text-sm flex justify-between items-center">
                                        <code className="font-mono text-primary">resolve_ticket</code>
                                        <span className="text-muted-foreground text-xs">Submit fix for testing</span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* --- API Documentation --- */}
                <TabsContent value="api" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Globe className="w-5 h-5 text-primary" />
                                <CardTitle>REST API</CardTitle>
                            </div>
                            <CardDescription>
                                Direct HTTP access for custom integrations.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div>
                                <h3 className="text-sm font-semibold mb-2">Authentication</h3>
                                <p className="text-sm text-muted-foreground mb-3">
                                    All requests (except public submission) require an API key.
                                </p>
                                <CodeBlock language="bash" code="Authorization: Bearer YOUR_API_KEY" />
                            </div>

                            <div>
                                <h3 className="text-sm font-semibold mb-2">Endpoints</h3>
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/10 text-green-500">GET</span>
                                            <code className="text-sm font-mono">/api/tickets</code>
                                        </div>
                                        <p className="text-xs text-muted-foreground">List all tickets. Supports filtering by status, priority, and assignee.</p>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-500">POST</span>
                                            <code className="text-sm font-mono">/api/tickets</code>
                                        </div>
                                        <p className="text-xs text-muted-foreground">Create a new ticket.</p>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/10 text-green-500">GET</span>
                                            <code className="text-sm font-mono">/api/tickets/:id/timeline</code>
                                        </div>
                                        <p className="text-xs text-muted-foreground">Get the full activity stream for a ticket.</p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
