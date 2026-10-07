---
name: matrx-sync
description: The AI Matrx sync, conflict and agent-board tools on this Mac. Use when syncing or shipping repos, resolving items in a repo's _conflicts/README.md, finding which conversation edited a file, telling another conversation something, seeing an URGENT MESSAGE WAITING line, or when one of these tools fails.
---

# Sync, conflicts and the agent board

All tools live in `__CODE_ROOT__/scripts/`.

| Need | Command |
|---|---|
| Sync + release one repo | `./ship.sh` in that repo |
| Sync + release every repo that needs it | `bash scripts/ship-all.sh` from `__CODE_ROOT__` (`--dry-run` to only look). Result: `~/.matrx/ship-all/latest.json` |
| See what is open in a repo | `<repo>/_conflicts/README.md`; check with `python3 scripts/check-conflict-markers.py` in that repo |
| Who edited a file | `python3 scripts/find-file-sessions.py <file>` |
| Leave a message for a conversation | `python3 scripts/board.py post <conversation id> "<message>" --title "<its title>" --app claude\|codex [--urgent]` |
| See urgent messages | `python3 scripts/board.py list` |
| After you delivered one | `python3 scripts/board.py done <number>` |

**Conflicts.** A held file is `<repo>/_conflicts/<time>/<file>.held`: our version, with a FACTS
block (who changed what, when). GitHub's version is live. Done = final code in the live file,
`.held` file deleted, its line deleted from the README. Both versions stay in git forever.

**The board** (`code/BOARD.md`). You can only message conversations in your own app instance:
in Claude, the ones `ListAgents` shows (send with `SendMessage`); in Codex, the threads your
send-to-thread tool reaches. When you see the line "URGENT MESSAGE WAITING" in your instructions:
run `board.py list`; if a recipient is in your own session list, message it, then run
`board.py done <number>` right away — that deletes the line and, when nothing urgent is left,
removes the marker for everyone. If you cannot reach any recipient, leave it for another agent.

**When a tool fails**, it prints the reason. ripgrep missing (slow lookups): `brew install ripgrep`.
