---
name: triage-tool-traces
description: Invoke when the user asks to "check the logs", "see what happened", "look at the trace", "review the latest debug log", "any failures lately", or otherwise asks for analysis of tool-call debug logs. Reads recent failures from both the local .matrx-debug/ files AND the cx_tool_trace DB (via the debug-traces MCP server when configured, or direct file reads as fallback). Classifies failures (agent vs extension vs server vs embedded_error_envelope), writes extension/server bugs to __CODE_ROOT__/matrx-extend/PENDING-TASKS.md, and deletes processed local files. Reports a per-source summary back to the user.
---

# Triage tool-call debug logs

Two sources of truth, in priority order:

1. **cx_tool_trace DB sink** — durable; survives Docker rebuilds; reachable from any machine via the [debug-traces MCP server](__CODE_ROOT__/aidream/docs/MCP_DEBUG_TRACES.md) (`get_failures_since`, `get_recent_events`). Prefer this when the MCP client is configured because it covers BOTH the local server AND production.
2. **`.matrx-debug/tool-trace-*.log` files** — local file sink. One file per server-process lifetime. Format produced by [packages/matrx-ai/matrx_ai/tools/_debug_log.py](__CODE_ROOT__/aidream/packages/matrx-ai/matrx_ai/tools/_debug_log.py). Use this when no MCP client is available, when you need raw line-by-line replay, or as a fallback if the DB sink missed events.

## When this skill applies

Triggers (verbatim or paraphrased):
- "check the logs"
- "look at the latest debug log"
- "see what happened in the last session"
- "any failures recently"
- "review the trace"
- "triage the logs"
- "what broke"

When invoked, **process every non-empty trace file** in chronological order (oldest first). Each gets its own per-session report.

## What the log looks like

Header line (always present):
```
# tool-trace log — process started 2026-05-06T02:25:46+00:00 (pid=55095)
```

Five event types, one per line:

| Event | Meaning | Sample |
|---|---|---|
| `OK` | Tool ran successfully | `[02:26:01.100] OK    tool=ctx_get kind=SERVER ms=0 conv=ab12cd34 call=b47d0282f` |
| `FAIL` | Tool ran but errored | `[02:26:04.092] FAIL  tool=read_active_page kind=DELEGATE ms=420 args={} err_type=client_tool_error err_msg=document is not defined conv=ab12cd34 call=393e723d9` |
| `SURFACE_REJECT` | Merge primitive dropped a tool that doesn't match the active UI surface | `[02:26:00.000] SURFACE_REJECT tool=cloud_browser active_surface=chrome-extension/pilot` |
| `NO_EXECUTOR` | Pre-flight rejected — LOCAL tool with no client delegation and empty function_path | `[02:26:00.000] NO_EXECUTOR tool=foo reason=LOCAL+empty_fn+not_delegated call=c1` |
| `LOOP_BLOCK` | Loop guard fired (5+ same-tool calls with similar args) | `[02:26:00.000] LOOP_BLOCK tool=read_page count=5 threshold=5 conv=conv-1` |

Field naming:
- `tool` — exposed name the model called (with bundle/namespace prefix if any)
- `kind` — `DELEGATE` (routed to client) or `SERVER` (server-dispatched)
- `ms` — duration in milliseconds
- `args` — JSON-encoded argument dict (FAIL events only)
- `err_type` — short error category: `client_tool_error`, `timeout`, `not_found`, `no_viable_executor`, `loop_detected`, `not_allowed`, `configuration`, `no_handler`, `mcp_remote`, etc.
- `err_msg` — full error message (truncated at 240 chars)
- `conv` — first 8 chars of conversation_id
- `call` — call_id (correlates to `cx_tl_call.call_id` row in DB if you need full detail)

## Skip rule

Files ≤ 100 bytes are header-only — the server started but no tool calls came through. **Always delete them** when sweeping the directory. The Phase 2 auto-cleanup also removes these at the next process start, but proactive deletion during triage keeps things tidy regardless of whether the server has restarted recently.

## Triage logic — three failure categories

For every `FAIL` line, classify by `err_type` + `err_msg` shape:

### Category A — Extension-side bug (most common)
Symptoms:
- `err_type=client_tool_error`
- `err_msg` mentions Chrome APIs (`scripting.executeScript`, `chrome.tabs.*`), JS-runtime errors (`document is not defined`, `<X> is not defined`), Zod schema failures from the extension (`args failed schema: {"_errors":..."}`), or any error message that quotes Chrome-extension internals.

These are **bugs in the extension's handlers**. Write each unique one to `PENDING-TASKS.md` (see template below).

### Category B — Agent-side issue
Symptoms:
- Agent passed args that the schema rejected (Zod error mentioning a `Required` field — e.g. `tabId` missing)
- Same tool called repeatedly with identical args until `LOOP_BLOCK` fires
- Tool not in the agent's available set (`err_type=not_allowed`)

These are **not extension bugs**. Note them in the per-session report you give the user; do NOT write them to PENDING-TASKS.md.

### Category C — Server / architecture bug
Symptoms:
- `NO_EXECUTOR` events (a tool exists but has no viable dispatch path)
- `SURFACE_REJECT` events (tool's surface assignment doesn't match request)
- `err_type=configuration` (function_path doesn't import)
- `err_type=no_handler` (external handler not registered)
- `err_type=mcp_remote` failures (MCP server flaky)

These usually need a server fix. Note them in the per-session report. If the bug is in matrx-extend tool data (e.g. surface assignment wrong), surface it to PENDING-TASKS.md too with a note that it's a data fix.

### Category D — Embedded error envelope (silent failure)
Symptoms:
- `err_type=embedded_error_envelope`

A tool returned `ToolResult(success=True, output={"success": False, ...})` — the outer flag said OK but the payload said the operation failed. The Phase 0.5 defense-in-depth in [`executor.py`](__CODE_ROOT__/aidream/packages/matrx-ai/matrx_ai/tools/executor.py) caught this and flipped the flag to False. **The tool implementation itself needs fixing** — either raise instead of returning the envelope, or have the caller check `result.get("success")`. Mirror the fix shape in `usertable_create` (`datasets_tools.py:518`). Write these to PENDING-TASKS.md AND notify the user — this is a high-priority bug class because every occurrence indicates a tool that was lying about success before the defense landed.

## Pattern detection

When the same `(tool, err_msg)` pair appears multiple times in one session, that's the **same bug repeating** — collapse to one task with a count. When it appears across multiple sessions, it's a **persistent unfixed bug** — note that in the task description so the priority is clear.

## Step-by-step procedure

### Source selection

First decide which source to use. The MCP server covers more ground but the file fallback always works.

- **MCP available** (check `.cursor/mcp.json` or your Claude MCP config for an `aidream-debug-traces*` entry):
  Use `get_failures_since` with an ISO cutoff (default to "last 24h" if user doesn't specify). One call covers BOTH the local and production servers. Skip steps 1-2 below; jump to step 3 with the returned events.
- **MCP not available**: fall back to the local `.matrx-debug/` files. Continue with steps 1-2.

### File-sink path (fallback / local-only)

1. **List all trace files** in `__CODE_ROOT__/aidream/.matrx-debug/` sorted by modification time (oldest first).

2. **For each file**:
   - Read it fully.
   - Delete if ≤ 100 bytes (header-only — no useful content).
   - Parse line-by-line. Count OK / FAIL / SURFACE_REJECT / NO_EXECUTOR / LOOP_BLOCK.
   - Classify each FAIL by category above.
   - Group: `(tool, err_type, normalized_err_msg)` → list of (call_id, args).
     Normalization: strip variable parts of `err_msg` (specific tabIds, timestamps, hex IDs) so `"tabId 908909085 not found"` and `"tabId 12345 not found"` collapse to one bug class.

3. **Write extension/server bugs to PENDING-TASKS.md**:
   - Append under `## Inbox`.
   - One numbered item per unique bug class found in this batch.
   - Include: tool name, what the agent passed (args sample), the full err_msg, occurrence count + which session(s) it appeared in, fix-path hypothesis.
   - Format the entry so it's actionable on its own (the extension dev should not need to re-read logs).
   - **Skip if a similar entry already exists in PENDING-TASKS.md** — don't duplicate.

4. **Delete processed log files** (`Bash`: `rm -f <path>`). Header-only files were already deleted in step 2.

5. **Per-source report to the user**:
   - Include: source (MCP vs file), time window, total events parsed, breakdown by category (A/B/C/D), specific failure list with categorization.
   - End with what was written to PENDING-TASKS.md (which items, summary).
   - For the file path: end with which log files were deleted.
   - For the MCP path: end with the highest-priority issue and the suggested next action.

### Deep-dive on one call

If a particular `call_id` needs more detail than the FAIL summary, use the `inspect-call` skill — it pulls the full forensic record (joined trace + cx_tl_call row) via the MCP server.

## PENDING-TASKS.md entry template

Append to `__CODE_ROOT__/matrx-extend/PENDING-TASKS.md` under `## Inbox`:

```markdown
- **[BUG] `<tool_name>` — <one-line summary>** (<N> occurrence(s) in <session timestamp(s)>)
  - **Args** (sample): `<truncated args dict>`
  - **Error**: `<full err_msg>`
  - **Suspected cause**: <one or two sentences — what's likely wrong in the extension code>
  - **Fix path**: <concrete suggestion: which file / which approach>
  - **Repro**: agent passed `<args>` to `<tool>` while on surface `<surface if known>`. Extension handler threw before completing the operation.
```

Format guidance:
- Lead with `**[BUG] tool_name — short summary**` so the inbox is scannable.
- Args + Error are non-negotiable: the extension dev needs both to reproduce.
- "Suspected cause" and "Fix path" are your best guess based on the error message — these save the dev's first 10 minutes of investigation. If you don't have a strong guess, write `unclear from log; check <handler file>`.
- Include the session timestamp(s) (e.g. `2026-05-06_02-25-46`) so the dev can pull the cx_tl_call row if they want full forensic detail (the `call=` field on the FAIL line gives them the call_id to query).

## Don't double-write

Before appending a new task, scan the existing `## Inbox` entries in PENDING-TASKS.md for the same `(tool_name, normalized_err_msg)`. If one already exists:
- If the existing task notes a count, increment it and add the new session timestamp to its occurrence list.
- If not, just add a parenthetical "(also seen in <new session>)" to the existing entry.
- Do NOT create a duplicate item.

## Examples

### Example: extension bug, write to inbox

Log line:
```
[02:26:04.092] FAIL  tool=read_active_page kind=DELEGATE ms=420 args={} err_type=client_tool_error err_msg=document is not defined conv=ab12cd34 call=393e723d9
```

Inbox entry:
```markdown
- **[BUG] `read_active_page` — handler runs in service-worker context where `document` is undefined** (1 occurrence in 2026-05-06_02-25-46)
  - **Args**: `{}` (no tabId — the tool is supposed to resolve the active tab itself)
  - **Error**: `document is not defined`
  - **Suspected cause**: the SW handler tries to read DOM directly instead of injecting via `chrome.scripting.executeScript`.
  - **Fix path**: in `src/lib/tools/handlers/<page-domain-handler>.ts`, resolve the active tabId via `chrome.tabs.query({active:true,currentWindow:true})`, then run the DOM walk inside `chrome.scripting.executeScript({target:{tabId},func:...})`. Mirror the pattern other read_page-family tools use.
  - **Repro**: agent passed `{}` to `read_active_page`. Handler threw before reaching the DOM.
```

### Example: agent issue, do NOT write to inbox

Log line:
```
[02:25:11.137] FAIL  tool=computer kind=DELEGATE ms=270 args={"action": "key", "text": "Tab"} err_type=client_tool_error err_msg=args failed schema: {"_errors":[],"tabId":{"_errors":["Required"]}} conv=ab12cd34 call=4ae674dcc
```

Per-session report (NOT to PENDING-TASKS.md):
```
Agent error: `computer` called without required tabId. Schema (server-side and extension-side) is correct to reject this. The agent's prompt or tool description may need to emphasize that tabId is required for every computer action.
```

### Example: clean session

If the log has 50 OK lines and 0 FAIL lines:

Per-session report:
```
2026-05-06_01-14-55: 40+ tool calls, 0 failures. Clean session — agent did navigate / read / click / find / form workflow without a single error. Server-side architecture (surface gates, executor selection, loop guard) showed no rejections. Nothing to write to PENDING-TASKS.md.
```

Then delete the log file.

## Output format to the user

Concise, scannable. Use this shape:

```
## Triage results — <N> sessions processed

### <session timestamp 1>
- OK: 40+, FAIL: 0
- Verdict: clean, no action needed.

### <session timestamp 2>
- OK: 54, FAIL: 3
- Failures:
  - 1× agent-side: `computer` missing tabId (not an extension bug)
  - 2× extension-side: `read_active_page` (document undefined), `computer.key` (unserializable args)
- Wrote 2 items to PENDING-TASKS.md (or "merged into existing items if duplicates")

### Logs cleaned up
- Deleted: <N> processed log files
- Skipped (header-only): <M> empty files

### What's next
<one or two sentences — patterns observed, anything systemic, what to watch for>
```

## Edge cases

- **Empty .matrx-debug directory**: tell the user "no logs to process" and stop.
- **Files in unexpected format**: if a file doesn't have the expected header or has corrupted lines, skip it and tell the user (don't delete).
- **PENDING-TASKS.md missing**: create it with the same header pattern as the existing one (look at it first if uncertain).
- **Permission errors deleting files**: report which file couldn't be deleted, continue with the rest.
- **Same bug, multiple sessions**: this is the most useful pattern to surface. Tell the user "this bug has appeared in 3 of the last 4 sessions — likely highest priority."

## Out of scope for this skill

- Don't pull `cx_tl_call` rows from the database to enrich findings. The log line has everything needed; if the dev wants more, they can query by `call_id` themselves.
- Don't try to fix the bugs you find — just report them.
- Don't modify the matrx-ai code based on what you see. If something on the server side needs fixing, report it to the user; don't auto-edit.
