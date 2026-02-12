# Matrx Ship Ticket System Documentation

The Matrx Ship Ticket System is a comprehensive, multi-tenant issue tracking solution designed for modern development workflows. It integrates directly with AI agents (via MCP), provides a user-facing portal, and includes a React SDK for embedding ticket submission into any application.

## Core Components

### 1. Admin Dashboard (`/admin/tickets`)
The central hub for managing tickets.
- **Pipeline View**: Visualize tickets by status (Untriaged, Your Decision, Agent Working, etc.).
- **Work Queue**: Prioritized list of approved tickets for agents/developers.
- **Ticket Details**: Full chronological timeline of every event (comments, status changes, test results).
- **Stats**: Real-time metrics on ticket volume and resolution.

### 2. User Portal (`/portal`)
A lightweight, standalone interface for end-users.
- **Submit Tickets**: Simple form for reporting bugs or requesting features.
- **Track Status**: Users can view the status and public timeline of their tickets using the ticket number (e.g., T-123).
- **Messaging**: Users can communicate with the team directly through the portal.

### 3. AI Agent Interface (MCP)
The system exposes a Model Context Protocol (MCP) server at `/api/mcp`. This allows AI agents (like Claude Desktop, Cursor, etc.) to:
- **Read Timelines**: Get the full context of a ticket in a single call (`get_ticket_timeline`).
- **Triage**: Analyze new tickets and suggest priorities/solutions (`triage_ticket`).
- **Submit Fixes**: Report test results and resolution notes (`resolve_ticket`).

### 4. React SDK (`@matrx/ticket-widget`)
A distributable library to embed ticketing capabilities into other React applications.
- **`TicketButton`**: A floating button that opens a submission form.
- **`TicketTracker`**: An embeddable component for users to view their request status.
- **`TicketProvider`**: Context provider handling authentication and API communication.

---

## Integration Guide

### React SDK Integration

To add the feedback widget to your application:

1.  **Install the package**:
    ```bash
    pnpm add @matrx/ticket-widget
    ```

2.  **Wrap your application**:
    ```tsx
    import { TicketProvider, TicketButton } from "@matrx/ticket-widget";
    import "@matrx/ticket-widget/styles.css";

    export default function App() {
      return (
        <TicketProvider 
          shipUrl="https://your-ship-instance.com"
          projectId="default"
        >
          <YourApp />
          <TicketButton />
        </TicketProvider>
      );
    }
    ```

### MCP Configuration for AI Agents

Add the following to your AI agent's configuration (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "matrx-ship": {
      "command": "node",
      "args": ["path/to/mcp-client.js"], 
      "endpoint": "http://localhost:3000/api/mcp",
      "env": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

*Note: Direct SSE connection support depends on the specific MCP client implementation.*

### REST API

The system provides a full REST API at `/api/tickets`.

**Authentication**:
All requests must include the `Authorization` header:
```
Authorization: Bearer YOUR_API_KEY
```

**Common Endpoints**:

-   `GET /api/tickets`: List tickets (supports filtering).
-   `POST /api/tickets`: Create a ticket.
-   `GET /api/tickets/:id`: Get ticket details.
-   `GET /api/tickets/:id/timeline`: Get the full activity history.
-   `POST /api/tickets/:id/activity`: Add a comment or message.

---

## Workflow Example

1.  **User Report**: User submits a bug via the SDK widget.
2.  **AI Triage**: An automated agent (via MCP) reads the new ticket, analyzes the bug, and sets it to `triaged` with a proposed solution.
3.  **Admin Approval**: You (the admin) review the triage in the dashboard and click "Approve". Status moves to `approved`.
4.  **Agent Work**: An AI coding agent picks up the ticket from the "Work Queue", writes code, and submits a `test_result`.
5.  **Resolution**: The admin verifies the fix and resolves the ticket. The user sees the update in the Portal.
