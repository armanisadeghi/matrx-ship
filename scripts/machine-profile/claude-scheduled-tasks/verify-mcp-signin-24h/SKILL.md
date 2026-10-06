---
name: verify-mcp-signin-24h
description: One-time 24h check that the Claude Code AI Dream MCP OAuth session stayed alive after the global-sign-out fix
---

You are verifying a fix shipped 2026-09-15 for "the AI Dream MCP keeps losing its sign-in inside Claude Code". Root cause: global-scope sign-outs (GoTrue POST /logout, supabase-js signOut() default) deleted every Supabase session of the account, including the OAuth-client session Claude Code holds. Fix: every sign-out is scope=local (matrx-frontend commit d1287fc14d live since 2026-09-15 16:35 UTC; aidream commit 9f0bb2e89). Background: __CODE_ROOT__/aidream/docs/agents_service/USING_THE_MCP.md section 5.

Do this, read-only, never print tokens:
1. Load the Supabase MCP tools with ToolSearch (mcp__supabase__execute_sql, mcp__supabase__query_logs). Project id: brsgrqvjdzwihsvnfqkf.
2. Run: select s.id, c.client_name, u.email, s.created_at, s.refreshed_at, (select count(*) from auth.refresh_tokens r where r.session_id=s.id and not r.revoked) live_rts from auth.sessions s join auth.oauth_clients c on c.id=s.oauth_client_id join auth.users u on u.id=s.user_id where c.client_name ilike 'Claude%' order by s.created_at desc;
   PASS condition: the "Claude Code (plugin:matrx:aidream)" session created 2026-09-15 17:08:53 UTC (id 3ebd5ca0-abdb-4172-b305-711d2e07e9cc) still exists with live_rts >= 1, and no newer plugin session was created (a newer one means Arman had to sign in again = FAIL).
3. Run query_logs for the last 24 hours, source='auth_logs', event_message ilike '%refresh_token_not_found%' — PASS condition: zero rows from path /oauth/token for remote_addr 68.4.250.160. Also count rows with '"action":"logout"' and, for each actor_username, run: select u.email, min(s.created_at) from auth.sessions s join auth.users u on u.id=s.user_id where u.email in ('admin@admin.com','arman@armansadeghi.com') group by 1 — PASS condition: min(created_at) for admin@admin.com is still 2026-09-15 02:02:47 UTC or earlier (no wipe happened).
4. curl https://server.app.matrxserver.com/health/version and note the SHA; in __CODE_ROOT__/aidream run `git fetch origin main` and `git log --format='%h %ad' --date=iso 9f0bb2e89..origin/main | wc -l` to count deploys since the fix (must be >= 2).
5. Use the Claude Code MCP tool mcp__plugin_matrx_aidream__server_status (or any plugin:matrx:aidream tool) once — PASS if it answers without "requires authentication".
Report in plain English: PASS or FAIL per check with the evidence rows, then one line "24-hour MCP sign-in verification: PASS/FAIL". If any check fails, file it with the AI Dream feedback tool (mcp__plugin_matrx_aidream__feedback, action report, type bug) with the evidence, and say so.