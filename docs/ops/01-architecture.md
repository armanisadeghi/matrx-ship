# Architecture Guide

## Server Hierarchy

The entire server infrastructure follows a strict four-layer hierarchy. Each layer serves as the safety net for the layer below it.

```
Layer 0 — Traefik          (reverse proxy, routes all traffic)
Layer 1 — Server Manager   (deploys & manages everything else)
Layer 2 — Deploy Server    (manages the Server Manager itself)
Layer 3 — App Instances    (Ship instances, agents, MCP servers)
```

### Layer 0: Traefik

**Role:** Reverse proxy and TLS termination.

- Routes incoming HTTPS traffic to the correct container based on hostname
- Handles Let's Encrypt certificate provisioning and renewal automatically
- Third-party package — we configure it, we don't modify its source
- Container: `traefik`
- Dashboard: `https://traefik.dev.codematrx.com` (HTTP basic auth)
- Config: `/srv/traefik/traefik.yml` (static), `/srv/traefik/dynamic/` (dynamic)

### Layer 1: Server Manager (Matrx Manager)

**Role:** The primary control plane for the entire server.

- Deploys, monitors, and manages every other service
- Creates and removes Ship app instances with dedicated Postgres databases
- Manages agent environments (Sysbox-based VM-like containers)
- Provides MCP protocol endpoint for AI agent interactions
- Exposes REST API and admin web UI
- Container: `matrx-manager`
- URL: `https://manager.dev.codematrx.com`
- Admin UI: `https://manager.dev.codematrx.com/admin/`
- Source: `/srv/projects/matrx-ship/server-manager/`
- Deployed from: `/srv/apps/server-manager/`

### Layer 2: Deploy Server

**Role:** Manages the Server Manager and serves as the emergency lifeline.

- Primary purpose: provide full control over the Server Manager without SSH
- Secondary purpose: manage app instance deployments and build history
- If the Server Manager goes down, the Deploy server is the recovery tool
- Container: `deploy-server`
- URL: `https://deploy.dev.codematrx.com`
- Source: `/srv/projects/matrx-ship/deploy/`
- Deployed from: `/srv/apps/deploy/`

### Layer 3: App Instances

**Role:** The actual applications being hosted.

- Each Ship instance runs as a Next.js container with its own dedicated Postgres
- Naming pattern: `ship-{name}` (app container), `ship-{name}-db` (database)
- Managed entirely by the Server Manager — not directly
- Agent environments run via Sysbox for VM-like isolation

---

## Network Architecture

All services communicate over the `proxy` Docker network.

```
Internet → Traefik (443/80) → proxy network → target container
```

### Key Networks

| Network | Purpose |
|---------|---------|
| `proxy` | Shared network for all services that need Traefik routing |
| `bridge` (default) | Isolated per-service networks for databases |

### Port Mappings

| Service | Internal Port | External Access |
|---------|--------------|-----------------|
| Traefik | 80, 443, 8080 | Direct (host ports) |
| Server Manager | 3000 | Via Traefik |
| Deploy Server | 3000 | Via Traefik |
| Ship Instances | 3000 | Via Traefik |
| PostgreSQL (shared) | 5432 | Internal only |
| pgAdmin | 80 | Via Traefik |
| Instance Postgres | 5432 | Internal only (per-instance) |

### DNS / Traefik Routing

All subdomains of `dev.codematrx.com` should point to the server IP via a wildcard DNS record (`*.dev.codematrx.com`).

Traefik automatically routes based on the `Host()` rule in Docker labels:

```
manager.dev.codematrx.com → matrx-manager:3000
deploy.dev.codematrx.com  → deploy-server:3000
{name}.dev.codematrx.com  → ship-{name}:3000
pgadmin.dev.codematrx.com → pgadmin:80
traefik.dev.codematrx.com → traefik:8080
```

---

## Data Persistence Strategy

### Three-Tier Persistence

Every piece of state must exist in at least one of these locations:

1. **Source Control (Git)** — Configuration files, Docker Compose, Dockerfiles, scripts, documentation
2. **Supabase** — Structured metadata: instance configs, tokens, build history, audit logs
3. **AWS S3** — Binary data: database backups, image archives, log archives

### Supabase Tables (matrx_infra schema)

| Table | Purpose |
|-------|---------|
| `infra_servers` | Server identity and metadata |
| `infra_instances` | App instance configurations |
| `infra_tokens` | Authentication tokens |
| `infra_builds` | Build and deployment history |
| `infra_backups` | Backup records with S3 references |
| `infra_audit_log` | Audit trail for all operations |

### Dual-Write Pattern

Both the Server Manager and Deploy Server write to local JSON files AND Supabase simultaneously. On startup, they sync local state to Supabase. In disaster recovery, state can be fully restored from Supabase.

---

## Docker Label Convention

All services use standardized Traefik labels:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.{service}.rule=Host(`{subdomain}.dev.codematrx.com`)"
  - "traefik.http.routers.{service}.entrypoints=websecure"
  - "traefik.http.routers.{service}.tls.certresolver=letsencrypt"
  - "traefik.http.services.{service}.loadbalancer.server.port={port}"
  - "traefik.docker.network=proxy"
```

---

## Directory Structure on Server

```
/srv/
├── traefik/              # Traefik config & certs
│   ├── traefik.yml
│   ├── acme.json
│   └── dynamic/
├── postgres/             # Shared PostgreSQL
│   ├── docker-compose.yml
│   └── data/
├── apps/
│   ├── server-manager/   # Server Manager deployment
│   │   ├── docker-compose.yml
│   │   ├── .env
│   │   └── data/
│   └── deploy/           # Deploy Server deployment
│       ├── docker-compose.yml
│       └── .env
├── agent-envs/           # Agent environments
│   ├── docker-compose.yml
│   └── images/
├── instances/            # App instance data (created dynamically)
│   └── {name}/
│       ├── docker-compose.yml
│       └── db-data/
└── projects/
    └── matrx-ship/       # Source code (Git clone)
```
