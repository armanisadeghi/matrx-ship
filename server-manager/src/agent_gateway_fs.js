// ── Agent Gateway: filesystem + search surface ──────────────────────────────
//
// The additive companion to the exec gateway. Implements the matrx-ai consumer
// contract (packages/matrx-ai/.../_sandbox_proxy.py) so an agent's structured
// file tools — not just the shell — work against a real target:
//
//   GET  /fs/list?path&recursive&depth   -> { entries: [stat,...] }
//   GET  /fs/stat?path                   -> stat
//   GET  /fs/read?path&encoding          -> text (utf8) | base64 string
//   PUT  /fs/write {path,content,...}    -> stat
//   POST /fs/mkdir {path,parents}        -> stat
//   POST /fs/patch {path,edits:[{old_text,new_text}],create_if_missing} -> stat
//   POST /search/content {query,cwd,...} -> { results: [{path,line_number,line}] }
//   POST /search/paths {pattern,cwd,...} -> { results: [{path}] }
//
// stat shape matches the daemon's get_stat_dict: {name,path,kind,size,mtime,mode,target}.
//
// Two target kinds (see agent_gateway.parseTarget):
//   host       -> Node fs against the host (the Manager sees /srv at /host-srv).
//   container  -> docker exec with portable POSIX commands.
//
// Each handler returns a plain object, or throws an Error with `.status` set so
// the route can map it to an HTTP code (404 missing, 400 bad request, 501 not
// supported on this target kind).

import {
  readFileSync, writeFileSync, mkdirSync, statSync, lstatSync, readdirSync, readlinkSync, existsSync,
} from "node:fs";
import { join, dirname, basename, isAbsolute, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { parseTarget } from "./agent_gateway.js";

const HOST_SRV = process.env.HOST_SRV_PATH || "/host-srv";
const HOST_DATA = process.env.HOST_DATA_PATH || "/host-data";

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Remap the host's logical /srv & /data onto the paths the Manager process sees.
function remapHostMount(path) {
  if (path === "/srv" || path.startsWith("/srv/")) return HOST_SRV + path.slice(4);
  if (path === "/data" || path.startsWith("/data/")) return HOST_DATA + path.slice(5);
  return path;
}

// Map an agent-supplied path to the path the Manager process can actually use
// for a HOST target, CONFINED to the granted root. Without the confinement check
// a path like `../../etc/passwd` would normalize out of the granted directory and
// give the agent arbitrary host-filesystem read/write. We resolve both the root
// and the requested path (collapsing `..`) and require the result to stay inside.
function hostPath(p, rootPath) {
  const rawRoot = rootPath || HOST_SRV;
  const root = resolve(remapHostMount(isAbsolute(rawRoot) ? rawRoot : join(HOST_SRV, rawRoot)));

  let path = String(p || "");
  if (!path) path = rawRoot;
  if (!isAbsolute(path)) path = join(rawRoot, path);
  const abs = resolve(remapHostMount(path));

  if (abs !== root && !abs.startsWith(root + sep)) {
    throw err(400, `Path escapes the granted root (${rawRoot}): ${p}`);
  }
  return abs;
}

function statDict(absPath, displayPath) {
  const ls = lstatSync(absPath);
  const isLink = ls.isSymbolicLink();
  const st = isLink ? (existsSync(absPath) ? statSync(absPath) : ls) : ls;
  return {
    name: basename(displayPath || absPath),
    path: displayPath || absPath,
    kind: st.isFile() ? "file" : st.isDirectory() ? "dir" : isLink ? "symlink" : "other",
    size: st.size,
    mtime: st.mtimeMs / 1000,
    mode: st.mode & 0o7777,
    target: isLink ? safeReadlink(absPath) : null,
  };
}
function safeReadlink(p) { try { return readlinkSync(p); } catch { return null; } }

// ── docker exec helper for container targets ────────────────────────────────
// Returns { code, stdout, stderr }. `input` is piped to stdin when provided.
function dockerExec(container, argvCommand, { input, binary = false } = {}) {
  try {
    const out = execFileSync("docker", ["exec", "-i", container, "sh", "-c", argvCommand], {
      input: input ?? undefined,
      maxBuffer: 64 * 1024 * 1024,
      encoding: binary ? "buffer" : "utf-8",
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout ?? (binary ? Buffer.alloc(0) : ""),
      stderr: (e.stderr?.toString?.() || e.message || ""),
    };
  }
}
function shq(s) { return `'${String(s).replace(/'/g, "'\\''")}'`; }

// ── Handlers ────────────────────────────────────────────────────────────────

export function fsList(payload, { path, depth = 1 } = {}) {
  const t = parseTarget(payload.t);
  if (t.kind === "host") {
    const abs = hostPath(path, payload.r);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw err(404, "Directory not found");
    const entries = [];
    walkHost(abs, path || payload.r, Math.max(1, Math.min(Number(depth) || 1, 8)), entries);
    return { entries };
  }
  // container
  const dir = path || payload.r || "/";
  const r = dockerExec(t.name, `ls -1Ap ${shq(dir)}`);
  if (r.code !== 0) throw err(404, r.stderr || "Directory not found");
  const entries = r.stdout.split("\n").filter(Boolean).map((nm) => {
    const isDir = nm.endsWith("/");
    const name = isDir ? nm.slice(0, -1) : nm;
    return { name, path: join(dir, name), kind: isDir ? "dir" : "file", size: 0, mtime: 0, mode: 0, target: null };
  });
  return { entries };
}

function walkHost(absDir, dispDir, depth, out) {
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const disp = join(dispDir, name);
    try {
      const sd = statDict(abs, disp);
      out.push(sd);
      if (depth > 1 && sd.kind === "dir") walkHost(abs, disp, depth - 1, out);
    } catch { /* skip unreadable */ }
  }
}

export function fsStat(payload, { path } = {}) {
  const t = parseTarget(payload.t);
  if (t.kind === "host") {
    const abs = hostPath(path, payload.r);
    if (!existsSync(abs)) throw err(404, "Path not found");
    return statDict(abs, path);
  }
  const r = dockerExec(t.name, `[ -e ${shq(path)} ] && { [ -d ${shq(path)} ] && echo dir || echo file; } || echo missing`);
  const kind = r.stdout.trim();
  if (kind === "missing") throw err(404, "Path not found");
  return { name: basename(path), path, kind, size: 0, mtime: 0, mode: 0, target: null };
}

export function fsRead(payload, { path, encoding = "utf8" } = {}) {
  const t = parseTarget(payload.t);
  if (t.kind === "host") {
    const abs = hostPath(path, payload.r);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw err(404, "File not found");
    const buf = readFileSync(abs);
    return encoding === "base64" ? buf.toString("base64") : buf.toString("utf-8");
  }
  const cmd = encoding === "base64" ? `base64 ${shq(path)}` : `cat ${shq(path)}`;
  const r = dockerExec(t.name, cmd);
  if (r.code !== 0) throw err(404, r.stderr || "File not found");
  return r.stdout;
}

export function fsWrite(payload, { path, content = "", encoding = "utf8", create_parents = true, mode } = {}) {
  const t = parseTarget(payload.t);
  const data = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(String(content), "utf-8");
  if (t.kind === "host") {
    const abs = hostPath(path, payload.r);
    if (create_parents) mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data, mode != null ? { mode } : undefined);
    return statDict(abs, path);
  }
  if (create_parents) dockerExec(t.name, `mkdir -p ${shq(dirname(path))}`);
  const r = dockerExec(t.name, `cat > ${shq(path)}`, { input: data });
  if (r.code !== 0) throw err(400, r.stderr || "write failed");
  return fsStat(payload, { path });
}

export function fsMkdir(payload, { path, parents = true } = {}) {
  const t = parseTarget(payload.t);
  if (t.kind === "host") {
    const abs = hostPath(path, payload.r);
    mkdirSync(abs, { recursive: !!parents });
    return statDict(abs, path);
  }
  const r = dockerExec(t.name, `mkdir ${parents ? "-p " : ""}${shq(path)}`);
  if (r.code !== 0) throw err(400, r.stderr || "mkdir failed");
  return fsStat(payload, { path });
}

// Search-and-replace edits ({old_text,new_text}); each applied to the first
// remaining occurrence, in order — matching the consumer's documented semantics.
export function fsPatch(payload, { path, edits = [], create_if_missing = false } = {}) {
  const t = parseTarget(payload.t);
  let content;
  if (t.kind === "host") {
    const abs = hostPath(path, payload.r);
    if (!existsSync(abs)) {
      if (!create_if_missing) throw err(404, "File not found");
      content = "";
    } else content = readFileSync(abs, "utf-8");
  } else {
    const r = dockerExec(t.name, `cat ${shq(path)}`);
    if (r.code !== 0) {
      if (!create_if_missing) throw err(404, "File not found");
      content = "";
    } else content = r.stdout;
  }
  for (const e of edits) {
    const oldText = e?.old_text ?? "";
    const newText = e?.new_text ?? "";
    if (oldText === "") { content += newText; continue; }
    const idx = content.indexOf(oldText);
    if (idx === -1) throw err(400, `patch failed: old_text not found: ${oldText.slice(0, 60)}`);
    content = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
  }
  return fsWrite(payload, { path, content, encoding: "utf8", create_parents: true });
}

// ── Search ──────────────────────────────────────────────────────────────────

export function searchContent(payload, { query, cwd, regex = true, case_sensitive = false, max_results = 100 } = {}) {
  const t = parseTarget(payload.t);
  const base = cwd || payload.r;
  const limit = Math.min(Math.max(Number(max_results) || 100, 1), 1000);
  if (t.kind === "host") {
    const re = buildRegex(query, regex, case_sensitive);
    const results = [];
    grepHost(hostPath(base, payload.r), base, re, limit, results);
    return { results };
  }
  // container: grep -rn (best-effort). flags: -r recursive, -n line numbers.
  const flags = `-rn${case_sensitive ? "" : "i"}${regex ? "E" : "F"}`;
  const r = dockerExec(t.name, `grep ${flags} -- ${shq(query)} ${shq(base)} 2>/dev/null | head -n ${limit}`);
  const results = r.stdout.split("\n").filter(Boolean).map((line) => {
    const m = /^([^:]+):(\d+):(.*)$/.exec(line);
    return m ? { path: m[1], line_number: Number(m[2]), line: m[3] } : { path: base, line_number: 0, line };
  });
  return { results };
}

export function searchPaths(payload, { pattern, cwd, max_results = 100 } = {}) {
  const t = parseTarget(payload.t);
  const base = cwd || payload.r;
  const limit = Math.min(Math.max(Number(max_results) || 100, 1), 2000);
  if (t.kind === "host") {
    const re = buildRegex(pattern, true, false);
    const results = [];
    walkPaths(hostPath(base, payload.r), base, re, limit, results);
    return { results };
  }
  const r = dockerExec(t.name, `find ${shq(base)} 2>/dev/null | grep -iE -- ${shq(pattern)} | head -n ${limit}`);
  return { results: r.stdout.split("\n").filter(Boolean).map((p) => ({ path: p })) };
}

function buildRegex(q, isRegex, caseSensitive) {
  const src = isRegex ? String(q) : String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(src, caseSensitive ? "" : "i");
}
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "__pycache__", ".venv", "venv", "dist", "build"]);
function grepHost(absDir, dispDir, re, limit, out) {
  if (out.length >= limit) return;
  let names;
  try { names = readdirSync(absDir); } catch { return; }
  for (const name of names) {
    if (out.length >= limit) return;
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(absDir, name);
    const disp = join(dispDir, name);
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    if (st.isDirectory()) { grepHost(abs, disp, re, limit, out); continue; }
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
    let text;
    try { text = readFileSync(abs, "utf-8"); } catch { continue; }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (re.test(lines[i])) out.push({ path: disp, line_number: i + 1, line: lines[i].slice(0, 400) });
    }
  }
}
function walkPaths(absDir, dispDir, re, limit, out) {
  if (out.length >= limit) return;
  let names;
  try { names = readdirSync(absDir); } catch { return; }
  for (const name of names) {
    if (out.length >= limit) return;
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(absDir, name);
    const disp = join(dispDir, name);
    if (re.test(name)) out.push({ path: disp });
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    if (st.isDirectory()) walkPaths(abs, disp, re, limit, out);
  }
}
