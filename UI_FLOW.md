# Server Manager — UI flow & naming (the mental model)

The admin should read top-down: **Servers → what runs on them → the individual
thing → its details/actions.** Every screen sits at one clear layer, and we use
ONE word per concept so nothing is ambiguous. This is the target structure the
UI is being refactored toward.

---

## Naming — one word per thing (kills the "instance" confusion)

| Use this | Means | NOT |
|---|---|---|
| **Server** | A machine with full shell access: this `/srv` host, or an EC2 box. | ~~instance~~ |
| **App** (a.k.a. *Deployment*) | A deployed project — a `matrx-ship:latest` container at `<name>.dev.codematrx.com`. | ~~instance~~ |
| **Database** | A project's Postgres (`db-<name>`) or the shared `postgres`. | |
| **Sandbox** | An ephemeral agent scratch container (`sbx-…`, or the deprecated `sandbox-1..5`). | ~~instance~~ |
| **Service** | A piece of infrastructure: Manager, Deploy, Orchestrator, Traefik, pgAdmin. | |
| **Orchestrator** | The service that spawns Sandboxes. | ~~the sandbox~~ |
| **Image / Template** | A build artifact (`matrx-ship:latest`, `matrx-sandbox:slim`). | |

> **The word "instance" is banned in the UI.** It has meant EC2 instance, Ship
> app, and sandbox all at once. An EC2 box is a **Server**; a deployed project is
> an **App**; an agent box is a **Sandbox**.

---

## The layers (top → bottom)

```
LAYER 1 — SERVERS (machines we have full access to)
  • this server (/srv)            Hostinger · runs everything below
  • matrx-sandbox-host-dev         EC2 i-084f757c1e47d4efb · the EC2 sandbox tier
  • matrx-python-server            EC2 i-0241f4fee60fb02f6 · the AI Dream backend
  • (+ others once identified)
        │
        ▼
LAYER 2 — WHAT RUNS ON A SERVER (for /srv, grouped by what it is)
  • Control plane     Server Manager, Deploy Server
  • Infrastructure    Traefik, Postgres, pgAdmin
  • Sandbox system    Orchestrator → its Sandboxes
  • Apps              the per-project deployments (+ each one's Database)
  • Agent envs        agent VMs
        │
        ▼
LAYER 3 — ONE ITEM (an App, a Sandbox, a Database, a Service)
        │
        ▼
LAYER 4 — ITS DETAILS & ACTIONS
  status · logs · env · terminal · backups · deploy/restart · etc.
```

The grouping in Layer 2 is the **canonical category set** (one source of truth in
the Manager: `KIND_CATEGORY` in `server-manager/src/index.js`, surfaced on every
target via `/api/containers` and `/api/agent-gw/targets`). The Terminal picker,
Agent Access catalog, and future pages all group + label by it, so the same thing
is named the same everywhere.

| Category | Members |
|---|---|
| Servers | the host + EC2 boxes |
| Control plane | `matrx-manager`, `matrx-deploy` |
| Infrastructure | `traefik`, `postgres`, `pgadmin` |
| Sandbox system | `matrx-orchestrator` |
| Sandboxes | `sbx-…`, `sandbox-1..5` (deprecated) |
| App deployments | the `matrx-ship:latest` apps |
| Databases | `db-<name>` |
| Agent environments | `agent-1` |

---

## Proposed navigation (reflects the layers)

| Group | Items | Who |
|---|---|---|
| **Fleet** | **Servers** (machines + status) · **Apps** · **Sandboxes** · **Databases** · **Services** | admin |
| **Access & Ops** | **Terminal** · **Agent Access** · **Hosts/EC2** · **Tokens** | super-admin |
| **Monitoring** | **Activity** · **Fleet Health** · **System** · **DB Health** | admin |
| **Build** | **Builds / Images** | admin |
| **Reference** | **Docs** | all |

(Today's nav still says "Instances", "Orchestrator Sandboxes", etc. — those get
renamed/regrouped to the above as the refactor lands. See
[SERVERS_AND_ROUTES.md](SERVERS_AND_ROUTES.md) for the live inventory and
[NAMING.md](NAMING.md) for the platform-wide taxonomy.)

---

## Rules for new screens

1. **State the layer.** A page is Servers, or items-on-a-server, or one item, or
   one item's detail — not a mix.
2. **Group + label, don't dump.** Lists of mixed things (containers, targets) are
   grouped by category with a human title — never a flat wall of raw names.
3. **Dense + sortable + filterable.** Use the shared `DataTable`
   (`components/admin/data-table.tsx`): sticky header, click-sort, filter box.
4. **One real terminal.** Interactive shells use `WebTerminal`. No more
   single-command "console" boxes.
5. **Name by the table above.** Never introduce a new word for an existing thing.
