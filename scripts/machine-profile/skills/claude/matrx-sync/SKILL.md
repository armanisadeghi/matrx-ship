---
name: matrx-sync
description: The AI Matrx sync, conflict and agent-mail tools on this Mac. Use when syncing or shipping repos, resolving items in a repo's _conflicts/README.md, finding which conversation edited a file, telling another conversation something, or when one of these tools fails.
---

# Sync, conflicts and agent mail

All tools live in `__CODE_ROOT__/scripts/`.

| Need | Command |
|---|---|
| Sync + release one repo | `./ship.sh` in that repo |
| Sync + release every repo that needs it | `bash scripts/ship-all.sh` from `__CODE_ROOT__` (`--dry-run` to only look). Result: `~/.matrx/ship-all/latest.json` |
| See what is open in a repo | `<repo>/_conflicts/README.md`; check with `python3 scripts/check-conflict-markers.py` in that repo |
| Who edited a file | `python3 scripts/find-file-sessions.py <file>` |
| Tell another conversation something | `python3 scripts/board.py post <conversation id or provider session id> "<message>" [--urgent]` |

**Conflicts.** A held file is `<repo>/_conflicts/<time>/<file>.held`: our version, with a FACTS
block (who changed what, when). GitHub's version is live. Done = final code in the live file,
`.held` file deleted, its line deleted from the README. Both versions stay in git forever.

**Agent mail.** `board.py post` delivers through agent mail (an urgent message wakes an idle session); the file board and its URGENT marker are gone. How it works: `aidream/aidream/services/agent_messaging/FEATURE.md`.

**When a tool fails**, it prints the reason. ripgrep missing (slow lookups): `brew install ripgrep`.
