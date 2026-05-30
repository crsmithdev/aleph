---
description: Resume from the most recent /handoff in a fresh context
---

Read `~/.aleph/handoffs/current.md` in full. If the file does not exist, say so and stop — do not guess.

Treat the contents as authoritative session context: the **Intent** is the user's goal, the **State** is ground truth (verify it before acting), the **Active plan** is your plan unless you have a strong reason to revise it, and the **Resume instructions** are your directive.

Before taking any action that the handoff tells you to take:

1. Verify the state described still matches reality. Run `git status`, `git log -5`, check that any referenced files still exist and contain what the handoff claims, confirm any servers/processes are still running if relevant. If reality has drifted from the handoff, surface the drift to the user before proceeding.
2. Archive the handoff so it isn't picked up twice: `mv ~/.aleph/handoffs/current.md ~/.aleph/handoffs/$(date +%Y-%m-%d-%H%M%S).md`.

Then follow the **Resume instructions** from the handoff. Lead with one sentence telling the user what you're picking up and what you're about to do — they may have switched contexts too.
