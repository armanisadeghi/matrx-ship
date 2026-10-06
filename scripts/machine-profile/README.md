---
type: Guide
title: Portable workstation profile
description: Secret-free prompts, templates, instructions, and an idempotent report-first bootstrap for AI Matrx workstations.
---

# Portable workstation profile

This is the canonical, secret-free machine profile under the Architecture > agent-machine-setup home. `setup-machine.sh --check` reports drift; `--install` adds only absent files and exact safe links. It preserves differing local files, never loads launchd jobs, and never imports a Codex automation into another host.

The profile contains 18 portable Claude task prompts, 39 Codex automation templates, the two clone launchd templates, and the portable Claude/Codex instruction files. Two source prompts were deliberately excluded because the secret scanner found credential-shaped material, and one was excluded because it depended on a private temporary session path. Their names and contents are not replicated here.

Codex automation, thread, and project identifiers are stripped because they are host-bound runtime state, and desktop scheduler enrollment is host-bound too. User and checkout paths are rendered from `__HOME__` and `__CODE_ROOT__` during installation. The rendered Codex templates land under `~/.codex/automation-templates/`, outside the active automation directory, for local enrollment. Claude task folders carry only prompts, not their cadence or enabled state. Therefore this profile cannot honestly activate those schedules on a new host. Enroll `ship-all-claude` locally at :13 and :43, as approved; all other machine schedules remain a local owner choice and must use their existing claim protocol.

The bootstrap checks for `gh`, `vercel`, `pnpm`, `uv`, `node`, `python3`, and `supabase`. Its report names missing tools and the human logins required. Credential values never belong here: use the approved vault or the repository-local gitignored environment file. Existing machine credential requirements and enrollment limits remain in [the parent feature](../FEATURE.md).

Update a prompt, template, or instruction here first. The next `setup-machine.sh --check` shows which machine copies differ. This is intentionally a warning rather than a change made during `ship-all`: release runs must not rewrite a developer's active agent configuration.
