---
name: education-school-readiness-checkpoint
description: One-week checkpoint on education school-market readiness: report progress on the prep worklist and whether the adversarial audit gate can be opened.
---

This is the one-week checkpoint Arman asked for on 2026-08-20, on the AI Matrx education product's readiness for the SCHOOL market.

BACKGROUND (self-contained — you have no memory of the conversation that created this):
The education product is at __CODE_ROOT__/common-docs/systems/education/. Read STATE.md and HANDOFF-child-safety.md first.

Arman's ruling on 2026-08-20, in his words: submitting our domain to school web-filter vendors for "Education" categorization is a critical task, but before we submit to ANY of them he wants **two independent agents — one in Claude Code and one in Codex — to go through the entire system and poke as many holes in it as they can.** Only when we are certain we can pass do we submit; and if one vendor has the lowest bar, we start with that one as a test. He explicitly said none of this could happen within that week, and that in the meantime we must be working off a list of everything that has to be done to be prepared, because we are not ready.

He was equally explicit about the priority order: **build the core first.** "We're not even in fucking production yet. We've gotta get agents focused on actually writing the code and finishing the plan before we start doing extra shit that just complicates things."

Also deferred to this checkpoint: engaging counsel on the legal layer (LEGAL_COUNSEL_BRIEF.md is written and unsent), and two child-safety risk acceptances that are his to make — whether post-hoc output moderation for minors stays unbuilt, and whether the universal child-safety guard keeps failing open.

Already ruled and NOT open: the COPPA gate must become account-scoped **platform-wide**, not per-feature ("obviously it's gonna have to be site-wide") — but sequenced after the core build.

DO THIS RUN:
1. Re-read the school-readiness worklist in CHILD_SAFETY_AND_SCHOOL_HANDOFF.md and check each item against live code and the live database (Supabase project txzxabzwovsujtloxrus). Do not trust the doc; verify.
2. Report, in one short message: what closed this week, what did not, and whether the adversarial-audit gate can now be opened.
3. If the worklist is close to done, offer to launch the two-agent adversarial hole-poking pass and name which filter vendor has the lowest bar to use as the test submission.
4. If it is not close, say so plainly and give the shortest path, and set the next checkpoint.
Keep it brief — he is juggling many projects and needs to answer in one line.