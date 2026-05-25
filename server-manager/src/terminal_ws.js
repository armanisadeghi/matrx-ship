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
  throw new Error(`invalid target '${target}'`);
}

// Attach the terminal WS handler to an http.Server.
//   deps.verifyToken(token) -> entry|null   (entry.role checked for admin)
//   deps.auditLog(actor, action, target, details)
export function attachTerminalWs(server, { verifyToken, auditLog } = {}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname, query } = parseUrl(req.url, true);
    if (pathname !== "/api/terminal") return; // not ours — leave for other handlers

    const reject = (code, msg) => {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\n\r\n`);
      socket.destroy();
    };

    // Auth: require an admin operator token (unless auth is disabled entirely).
    const authConfigured = !!(process.env.MANAGER_TOKENS || process.env.MANAGER_BEARER_TOKEN || process.env.MCP_BEARER_TOKEN);
    let entry = null;
    if (authConfigured) {
      const token = pickToken(req, query);
      entry = token ? verifyToken(token) : null;
      if (!entry) return reject(401, "Unauthorized");
      if (entry.role && entry.role !== "admin") return reject(403, "Forbidden");
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
