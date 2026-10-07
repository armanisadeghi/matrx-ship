---
name: usage-guard
description: The usage watchdog. Pauses every running Claude Code session gracefully before the 5-hour plan limit hits, records them, and restarts them after the limit resets. Use when invoked as /usage-guard, when told "go" or "arm" in the Usage Watchdog session, when a cron tick says "usage-guard tick", or when asked to pause or resume all sessions around a usage limit.
---

# Usage guard

Hitting the 5-hour plan limit mid-flight errors every session at once; an agent with 10–20 subagents loses their state. This skill turns that crash into a planned pause and an automatic restart.

**It only works from a normal session the user opened** — `send_message` is unavailable in scheduled-task and remote-dispatched sessions. Run it in a dedicated, otherwise-empty session titled **Usage Watchdog** so each tick is cheap. Never do other work in that session.

State lives in `~/.claude/usage-guard/`:
- `config.json` — the knobs (`pause_at_percent`, `resume_below_percent`, `tick_minutes`, weekly variants). Read it every tick; never hardcode.
- `ledger.json` — `{"paused": [{sessionId, title, pausedAt, resetsAt, delivery}]}`. The list of sessions that must be woken. `pausedAt` comes from `date -u +%FT%TZ`, `resetsAt` verbatim from `get_usage` — never typed from memory.
- `heartbeat` — touched every tick. The access guard notifies the user when it goes stale, so a dead watchdog is never silent.
- `history.log` — one line per pause/resume/wake event.
- `find-limit-errors.py` — read-only scanner: lists sessions whose last assistant turn is a usage-limit error (cut off mid-turn, or woken by a background task during the blackout). The session list has no error flag; this is the only way to see them. Run it with `python3 ~/.claude/usage-guard/find-limit-errors.py`.

Tools (load with ToolSearch if deferred): `mcp__ccd_session_mgmt__get_usage`, `list_sessions`, `send_message`, `set_session_title`, plus `CronCreate`, `CronList`.

## Arm (on "/usage-guard", "go", "arm", or first run)

1. Title this session `Usage Watchdog` (`set_session_title`, session "self").
2. `CronList`. If no usage-guard tick exists, `CronCreate` recurring `*/<tick_minutes> * * * *` with prompt exactly: `usage-guard tick`. Recurring crons expire after 7 days — on any tick where the job is older than 6 days, create a fresh one and delete the old.
3. Run one tick now.
4. Reply in one line: armed, current 5-hour percent, reset time, ledger size.

## Tick

Do exactly this, then stop. No commentary beyond the one-line result.

1. `touch ~/.claude/usage-guard/heartbeat`; read `config.json` and `ledger.json`.
2. `get_usage`. If plan status is not `ok`, reply `usage unreadable: <note>` and stop (next tick retries).
   Convert the 5-hour window's `resetsAt` to local time ONLY with the shell — never in your head (on 2026-09-17 a mental conversion said 6:30 PM for a 3:30 PM reset, and every paused agent set its safety-net wake-up three hours late):
   `python3 -c 'from datetime import datetime;print(datetime.fromisoformat("<resetsAt>".replace("Z","+00:00")).astimezone().strftime("%-I:%M %p %Z"))'`
3. Let `p` = the 5-hour window's `percentUsed`.
   - **Resume** — ledger non-empty AND `p < resume_below_percent` AND now is past the entry's `resetsAt`: run *Resume*.
   - **Pause** — `p >= pause_at_percent` (or the weekly window ≥ `weekly_pause_at_percent` when `also_watch_weekly`): run *Pause*.
   - **Sweep** — on every tick where `p < resume_below_percent` (the limit is not in force), run *Sweep* before replying.
   - Otherwise reply `ok <p>%` and stop.

## Pause

1. `list_sessions` (limit 50). Targets = rows with `isRunning: true` that are not already in the ledger. Sessions that are idle are left alone — they have nothing in flight and messaging them burns usage.
2. Send each target the PAUSE MESSAGE below, substituting the reset time in the user's local time. Send all of them before doing anything else; every second counts.
3. Write each to the ledger with the `delivery` result (`delivered` / `queued` / the error). An error is recorded, not retried in a loop.
   `queued` means the session is mid-turn OR stuck on a human prompt (plan approval, a permission dialog, a question). `isRunning` cannot tell these apart. So: 90 seconds after sending, re-check each `queued` target with `get_session`/`list_sessions` (`lastActivityAt` unchanged = nothing dequeued it). Mark those `blocked_on_prompt` in the ledger and name them in the PushNotification — "Workflow studio is waiting for you to approve a plan; nothing can reach it until you click" — because only Arman can clear that and the message will otherwise sit forever.
4. Append to `history.log`; send one `PushNotification`: "Paused N sessions at P%. Auto-restart after <reset time>."
5. Delete the recurring tick and create ONE one-shot tick (`recurring: false`) at `resetsAt` + 3 minutes, prompt `usage-guard tick`. Ticking through the blackout only produces "hit your session limit" errors in this session (22:29Z on 2026-09-17) and looks like a crash to the user. The one-shot tick performs Resume and then re-arms the recurring tick.
6. Reply with the table of paused sessions. Nothing else.

If the weekly window triggered the pause, say so in the message and the notification — a weekly reset can be days away, and the user must decide, not the watchdog: do NOT auto-resume weekly pauses; leave them in the ledger marked `"weekly": true`.

## Resume

1. For each non-weekly ledger entry, send the RESUME MESSAGE.
2. Remove entries whose delivery was `delivered` or `queued`; keep failures and report them.
3. Append to `history.log`; `PushNotification`: "Limit reset — restarted N sessions." Name any session that could not be reached and why.
4. Re-arm the recurring tick (`*/<tick_minutes> * * * *`) if it is not present in `CronList`.

## Sweep (wake sessions the limit cut off)

The pause only reaches sessions that were running at the trigger. Sessions idle at that moment can still be woken by a background task or their own timer during the blackout, hit the limit, and sit showing an error until someone notices (2026-09-17: "AI matrix proof of concept" — cut off at 3:15 pm by a subagent notification, invisible to the watchdog).

1. Run `python3 ~/.claude/usage-guard/find-limit-errors.py`.
2. For each row with `kind: session`: send the WAKE MESSAGE, append `WAKE <title>` to `history.log`. Send once per session per error — record `{sessionId, erroredAt}` in `ledger.json` under `"woken"` and skip rows already there.
3. Rows with `kind: monthly_spend` or `weekly`: never message (the limit has not reset). Name them in one PushNotification to Arman with the kind — that is his decision.
4. If anything was woken, PushNotification: "Woke N session(s) the limit cut off: <titles>."
5. Reply `ok <p>%, woke N` (or the usual `ok <p>%`).

## After an app restart

Cron jobs die with the app; the ledger does not. When armed and the ledger is non-empty, the first tick applies the normal Resume rule — so opening this session and typing `go` is the whole recovery.

## PAUSE MESSAGE

```
PLANNED PAUSE — the account's 5-hour usage limit is about to be reached (resets at {RESET_TIME}). This is not a problem with your work. Wind down cleanly now, in this order, and spend as few tokens as possible doing it:

1. Start nothing new. No new subagents, no new tool-heavy steps.
2. Subagents: let any that are within a minute or two of finishing finish. Send every other one this same instruction so it stops at a safe point and reports where it stopped. Do not leave any running unattended.
3. Make the work safe: commit and push anything complete; leave nothing half-applied (a migration, a deploy, a multi-file edit) — finish that one step or roll it back, and say which.
4. Write your restart note where you would normally keep state (your handoff doc if the task has one, otherwise a file beside your work) — for each paused item: what it was doing, exactly where it stopped, and the precise instruction needed to restart it, including which subagents to relaunch and with what brief.
5. Set a one-shot wake-up for yourself with CronCreate at {RESET_TIME} plus 10 minutes, prompt "Resume after planned usage pause — read your restart note and continue." This is the safety net; you will normally be woken sooner.
6. End with a short status measured against what I originally asked you to deliver: the final deliverables, what is done and live, what is pending, what was in flight and is now paused, and where the restart note is.

Then stop and wait. Do not keep working "just a bit more" — a hard cutoff mid-step is what this pause exists to prevent.
```

## WAKE MESSAGE (for a session the limit cut off — it never got the pause)

```
You were cut off by the account's usage limit at {ERROR_TIME}; your last turn ended in a "hit your session limit" error and nothing after it ran. The limit has reset. Look at the last instruction or notification you received before the error (a user message, a task notification, a timer) and carry it out now. First verify the state you left (anything committed, applied, deployed or half-edited) before building on it. Check whether any subagents or background tasks you had running finished, failed, or need relaunching. Then continue your original task. No recap needed.
```

## RESUME MESSAGE

```
The usage limit has reset — resume now. Read your restart note, relaunch the subagents you paused with the briefs you recorded, and continue the original task from where you stopped. Cancel your own safety-net wake-up if it has not fired. First verify the state you left (anything committed, applied, or deployed just before the pause) before building on it. No recap needed — just continue, and report as you normally would.
```

## Manual commands in the watchdog session

- `pause now` — run Pause regardless of percent.
- `sweep now` — run Sweep regardless of percent.
- `resume now` — run Resume regardless of percent.
- `status` — percent, reset time, ledger, cron state.
- `disarm` — delete the cron; leave the ledger.
