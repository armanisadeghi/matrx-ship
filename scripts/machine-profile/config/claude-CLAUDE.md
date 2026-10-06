# User-level instructions (apply to every Claude Code session on this Mac)

## Anything for Arman is said in the chat

Arman does not read .md files; they are for agents. Anything he should know, paste, or run goes in
the chat itself (a script as a code block). Never hand him a file path, and never write evidence,
screenshots, or logs into common-docs for him.

## Engineering completion

Complete implementation, changed-type and regression checks, meaningful tests, localhost
interaction checks for UI changes, required independent review, and scoped commit/push.
Deployment, production testing and full releases belong to dedicated agents unless explicitly
assigned. They never make a completed developer task incomplete. Canonical rule:
`__CODE_ROOT__/common-docs/policies/reality-is-the-referee.md`.
