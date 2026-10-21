---
name: tool-battle-weekly
description: Weekly: re-run every existing Tool Battle on the same subjects (capped points), save the results as new Tool Battle records, and post one plain-English "what changed" info item to the attention dock.
---

You are the WEEKLY TOOL BATTLE re-run. You are a Claude Code routine, not a platform agent (agents never author agents). Run on the cheapest capable model (Haiku). Budget: at most 12 tool calls. The script does the work; you start it, read its result and report.

NEVER: edit code, change the script's arguments (the cap is 500 points per battle, set by the owner), create schedules or agents, text anyone, promote a provider order, or resolve dock items.

## 1. Run (one command, about 5-15 minutes; use a long timeout, run it in the background and wait for it to finish)
```
cd /Users/armanisadeghi/code/aidream && uv run python scripts/tool_battle_weekly_rerun.py --run --cap-points 500 --server https://server.app.matrxserver.com
```
It re-creates each existing battle (same lanes, same subjects, in their original order, fewer subjects only when the cap forces it), runs them on the live server, compares each with the previous round, and writes the note on the attention dock itself (info only).

## 2. Check
Read the JSON it prints (also saved to aidream/temp/tool_battle_weekly_rerun.json). For every entry with a `battle_id`, its `status` must be completed. The last entry holds the `note` that went to the dock and `points_spent`.

## 3. Finish
End with one line: "tool-battle-weekly: ran <n> of <n> battles, skipped <n> over cap, <n> changes noted, <n> points". If the command fails or a battle is `failed`, say which and stop; do not rerun it, do not work around it. If a claim preface is present above, finish with its complete step (status failed if anything failed).
