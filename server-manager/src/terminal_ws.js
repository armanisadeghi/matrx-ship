// ── Browser terminals: WebSocket → PTY bridge ───────────────────────────────
//
// Gives the admin UI a real interactive shell into the /srv host or any
// container, via xterm.js over a WebSocket. The Manager spawns a PTY and pipes
// it to the browser:
//   host             -> a login bash in the Manager container (sees /host-srv +
//                       the docker socket — i.e. operator-level host control)
//   container:<name> -> docker exec -it <name> (bash if present, else sh)
//
// Auth: operator bearer token (admin role), passed as a WebSocket subprotocol
// ("matrx-token, <token>") so it never lands in a URL/access log; a ?token=
// query param is accepted as a fallback. Every session is audited.
//
// Wire protocol (browser <-> server):
//   server -> client : raw terminal output bytes
//   client -> server : raw keystroke bytes, EXCEPT a JSON control frame
//                       {"type":"resize","cols":N,"rows":M}

import { WebSocketServer } from "ws";
import pty from "node-pty";
import { parse as parseUrl } from "node:url";
import { FLEET_HOSTS } from "./aws.js";

const MAX_SESSION_MS = 4 * 60 * 60 * 1000; // hard cap: 4h per terminal.

function pickToken(req, query) {
  const proto = req.headers["sec-websocket-protocol"];
  if (proto) {
    const parts = proto.split(",").map((s) => s.trim());
    if (parts[0] === "matrx-token" && parts[1]) return parts[1];
  }
  return query.token || null;
}

function spawnForTarget(target, { cols, rows }) {
  const opts = { name: "xterm-color", cols: cols || 80, rows: rows || 24, env: process.env };
  if (target === "host") {
    return pty.spawn("bash", ["-l"], { ...opts, cwd: process.env.HOST_SRV_PATH || "/host-srv" });
  }
  const m = /^container:([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(target || "");
  if (m) {
    // Prefer bash inside the container, gracefully fall back to sh.
    return pty.spawn(
      "docker",
      ["exec", "-it", m[1], "sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"],
      opts,
    );
  }
  // A sandbox box IS a container (named by its sandbox_id). Shell in AS THE
  // AGENT USER, in its home dir — i.e. exactly what the agent sees — so an
  // operator can "look inside" the box the way the agent experiences it.
  const s = /^sandbox:([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(target || "");
  if (s) {
    return pty.spawn(
      "docker",
      ["exec", "-it", "-u", "agent", "-w", "/home/agent", s[1],
       "sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"],
      opts,
    );
  }
  // ec2:<fleet-id> — a live shell on a remote EC2 box via AWS SSM StartSession
  // (no inbound SSH, no keys). Uses the matrx-admin creds; the session-manager-
  // plugin is baked into the image. Runs under the PTY so xterm renders it.
  const e = /^ec2:([A-Za-z0-9_.-]+)$/.exec(target || "");
  if (e) {
    const h = FLEET_HOSTS[e[1]];
    if (!h) throw new Error(`unknown EC2 host '${e[1]}'`);
    const env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: process.env.MATRX_ADMIN_AWS_ACCESS_KEY_ID || "",
      AWS_SECRET_ACCESS_KEY: process.env.MATRX_ADMIN_AWS_SECRET_ACCESS_KEY || "",
      AWS_DEFAULT_REGION: process.env.MATRX_ADMIN_AWS_REGION || "us-east-1",
    };
    return pty.spawn("aws", ["ssm", "start-session", "--target", h.instanceId], { ...opts, env });
  }
  throw new Error(`invalid target '${target}'`);
}

// Attach the terminal WS handler to an http.Server.
//   deps.verifyToken(token) -> entry|null            (operator tokens)
//   deps.oauthEnabled() -> bool
//   deps.authenticateOAuthAdmin(token) -> {ok,isSuperadmin,email,...}  (async)
//   deps.auditLog(actor, action, target, details)
// A live shell is "access" — gated to SUPERADMINS only (operator admin tokens,
// or OAuth admins whose admins.level == super_admin).
export function attachTerminalWs(server, { verifyToken, auditLog, oauthEnabled, authenticateOAuthAdmin } = {}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const { pathname, query } = parseUrl(req.url, true);
    if (pathname !== "/api/terminal") return; // not ours — leave for other handlers

    const reject = (code, msg) => {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\n\r\n`);
      socket.destroy();
    };

    // Auth: resolve the caller to a superadmin (unless auth is disabled).
    const authConfigured = !!(process.env.MANAGER_TOKENS || process.env.MANAGER_BEARER_TOKEN || process.env.MCP_BEARER_TOKEN || (oauthEnabled && oauthEnabled()));
    let entry = null; // { label }
    if (authConfigured) {
      const token = pickToken(req, query);
      if (!token) return reject(401, "Unauthorized");
      let isSuperadmin = false;
      const op = verifyToken(token);
      if (op) {
        isSuperadmin = op.role === "admin";
        entry = { label: op.label };
      } else if (oauthEnabled && oauthEnabled()) {
        try {
          const r = await authenticateOAuthAdmin(token);
          if (r.ok) { isSuperadmin = r.isSuperadmin; entry = { label: r.email || "oauth-admin" }; }
        } catch { /* fall through */ }
      }
      if (!entry) return reject(401, "Unauthorized");
      if (!isSuperadmin) return reject(403, "Forbidden — requires superadmin");
    }

    const target = String(query.target || "host");
    wss.handleUpgrade(req, socket, head, (ws) => {
      let term;
      try {
        term = spawnForTarget(target, { cols: Number(query.cols), rows: Number(query.rows) });
      } catch (e) {
        ws.send(`\r\n[terminal error: ${e.message}]\r\n`);
        ws.close();
        return;
      }

      try { auditLog?.(entry?.label || "operator", "terminal_open", target, {}); } catch { /* */ }

      const killTimer = setTimeout(() => { try { ws.close(); } catch { /* */ } }, MAX_SESSION_MS);

      term.onData((d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
      term.onExit(() => { clearTimeout(killTimer); try { ws.close(); } catch { /* */ } });

      ws.on("message", (raw) => {
        const msg = raw.toString();
        if (msg.length && msg[0] === "{") {
          try {
            const ctl = JSON.parse(msg);
            if (ctl && ctl.type === "resize" && ctl.cols && ctl.rows) {
              term.resize(Number(ctl.cols), Number(ctl.rows));
              return;
            }
          } catch { /* not a control frame — fall through to input */ }
        }
        term.write(msg);
      });

      ws.on("close", () => { clearTimeout(killTimer); try { term.kill(); } catch { /* */ } });
      ws.on("error", () => { try { term.kill(); } catch { /* */ } });
    });
  });

  return wss;
}
