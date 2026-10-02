---
name: pickup
description: >
  Pick up a saved handoff in a fresh context. Use when the user asks to pick
  up or resume where they left off.
---

Read `~/.aleph/handoffs/<name>.md` in full. `<name>` is the argument, if one is given, and `current` if not. If the file does not exist, say so and stop. Do not guess.

Treat the contents as authoritative session context: the **Intent** is the user's goal, the **State** is ground truth (verify it before acting), the **Active plan** is your plan unless you have a strong reason to revise it, and the **Resume instructions** are your directive.

Before taking any action the handoff tells you to take:

1. Verify the state described still matches reality. Run `git status`, `git log -5`, check that referenced files still exist and contain what the handoff claims, confirm any servers or processes are still running if relevant. If reality has drifted from the handoff, surface the drift to the user before proceeding.
2. Archive the handoff so it isn't picked up twice: `mv ~/.aleph/handoffs/<name>.md ~/.aleph/handoffs/$(date +%Y-%m-%d-%H%M%S)-<name>.md`. The date comes first because `vault compile` reads a day's handoffs by that prefix.

Then follow the **Resume instructions**. Lead with one sentence telling the user what you're picking up and what you're about to do. They may have switched contexts too.
