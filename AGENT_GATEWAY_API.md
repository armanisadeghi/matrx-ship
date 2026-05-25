# Agent Gateway API

Real-infra agent access — give a coding agent live shell + filesystem access to
the **`/srv` host** or **any container** on it, the same way a developer (or
Claude) works directly, instead of in a throwaway sandbox. The Server Manager is
the authenticated proxy: it mints a scoped, expiring token and runs operations
on the target. **No unauthenticated daemon runs anywhere** — auth is enforced by
the Manager on every call.

This document is the contract for driving the gateway **directly over HTTP**
(e.g. a remote admin trigger), in addition to the portal UI at
`manager.dev.codematrx.com/admin/agent-access`.

> **Implementation:** [`server-manager/src/agent_gateway.js`](server-manager/src/agent_gateway.js)
> (tokens), [`server-manager/src/agent_gateway_fs.js`](server-manager/src/agent_gateway_fs.js)
> (filesystem/search), routes in [`server-manager/src/index.js`](server-manager/src/index.js).

---

## Two kinds of credential

| Credential | Header | Who holds it | Used for |
|---|---|---|---|
| **Operator token** | `Authorization: Bearer <token>` | An admin (you / a remote trigger) | Minting + revoking bindings, reading the audit log. Role `admin`. |
| **Scoped binding token** | `X-Sandbox-Access-Token: <token>` | The coding agent | Running commands / file ops on the one granted target. |

The operator mints a **binding** (one call) and hands it to an agent. The agent
uses only the scoped token, and only for the single target it was granted.

---

## Enable / disable

The gateway is **off unless `AGENT_GW_SECRET` (≥32 chars) is set** in
`/srv/apps/server-manager/.env`. When unset, every route returns `503`.
Rotating the secret instantly invalidates all outstanding bindings.

```
GET /api/agent-gw/status        (admin)   ->  { "enabled": true }
```

---

## Targets

- `host` — the `/srv` host. Advertised root is **`/host-srv`** (the Manager sees
  the host's `/srv` mounted there; writes to `/host-srv/...` land on real `/srv`).
- `container:<name>` — any container on the host, e.g. `container:postgres`.

---

## Mint a binding — `POST /api/agent-gw/grant` (admin)

```bash
curl -X POST https://manager.dev.codematrx.com/api/agent-gw/grant \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "target": "host", "ttl": 3600 }'
```

Body fields:

| Field | Required | Default | Notes |
|---|---|---|---|
| `target` | yes | — | `host` or `container:<name>` |
| `ttl` | no | `3600` | seconds; clamped `[60, 43200]` (1 min – 12 h) |
| `root_path` | no | `/host-srv` (host) / `/` (container) | advertised working root |
| `scopes` | no | `["exec.run","fs.read","fs.write","search"]` | subset of `exec.run, fs.read, fs.write, search, git` |
| `label` | no | operator's token label | shown in the audit log |

Response — **this is exactly matrx-ai's `active_sandbox` binding shape**, so it
drops straight into `AppContext.metadata["active_sandbox"]`:

```json
{
  "sandbox_id": "infra:host",
  "base_url": "https://manager.dev.codematrx.com/api/agent-gw/t/host",
  "access_token": "<scoped token — give to the agent>",
  "root_path": "/host-srv",
  "target": "host",
  "scopes": ["exec.run","fs.read","fs.write","search"],
  "jti": "….",
  "expires_at": "2026-05-25T21:18:36.000Z"
}
```

---

## Agent endpoints (scoped token: `X-Sandbox-Access-Token`)

All are under the binding's `base_url` = `/api/agent-gw/t/:target`.

### Run a command — `POST {base_url}/exec`  (scope `exec.run`)

Request / response match matrx-ai's `exec_command` 1:1:

```bash
curl -X POST "$BASE_URL/exec" \
  -H "X-Sandbox-Access-Token: $AT" -H "Content-Type: application/json" \
  -d '{ "command": "whoami; ls", "cwd": "/host-srv", "timeout": 60 }'
# -> { "exit_code": 0, "stdout": "...", "stderr": "", "cwd": "/host-srv" }
```
Optional body: `user`, `env` (object), `stdin`, `timeout` (s, ≤600).

### Filesystem (scopes `fs.read` / `fs.write`)

| Method · path | Scope | Body / query | Returns |
|---|---|---|---|
| `GET {base}/fs/list?path=&depth=` | fs.read | — | `{ entries: [stat…] }` |
| `GET {base}/fs/stat?path=` | fs.read | — | `stat` |
| `GET {base}/fs/read?path=&encoding=` | fs.read | `encoding=utf8\|base64` | raw `text/plain` body |
| `PUT {base}/fs/write` | fs.write | `{path, content, encoding?, create_parents?, mode?}` | `stat` |
| `POST {base}/fs/mkdir` | fs.write | `{path, parents?}` | `stat` |
| `POST {base}/fs/patch` | fs.write | `{path, edits:[{old_text,new_text}], create_if_missing?}` | `stat` |
| `POST {base}/search/content` | search | `{query, cwd?, regex?, case_sensitive?, max_results?}` | `{ results:[{path,line_number,line}] }` |
| `POST {base}/search/paths` | search | `{pattern, cwd?, max_results?}` | `{ results:[{path}] }` |

`stat` = `{name, path, kind, size, mtime, mode, target}`.

---

## Revoke + audit (admin)

```
POST /api/agent-gw/revoke      { "jti": "…" }      # kill one binding now
GET  /api/audit?limit=&actor=&action=              # activity log, newest first
```

Every grant, exec, file op, and revoke is written to the audit trail
(`/srv/apps/manager-audit.jsonl`) and visible at `/admin/activity`.

---

## Security model & open items

- **Auth is enforced at the Manager.** The scoped token is HMAC-SHA256 over its
  payload (signature checked timing-safely), carries an expiry + target binding +
  `jti`, and is rejected if tampered / expired / wrong-target / revoked / when the
  gateway is disabled.
- **`exec` is full command execution on real prod infra.** Treat a leaked scoped
  token like a shell on the box — but it expires and is revocable.
- The reverse-tag guard (no deleting `matrx-sandbox:*` / `matrx-orchestrator`
  images) applies to gateway commands too.
- **TODO (planned together): superadmin gate.** Minting bindings is currently
  `admin`-role. We intend to add a stricter superadmin gate for `grant` (and for
  the remote-trigger entry point) — see the auth work in progress. Until then,
  guard the operator token like a root credential.
- **Container filesystem ops** go through `docker exec` and assume a POSIX shell +
  coreutils in the target; `list`/`stat` are best-effort there. The shell (`exec`)
  is the universal fallback.
