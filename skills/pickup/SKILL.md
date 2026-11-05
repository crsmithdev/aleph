---
name: pickup
description: >
  Pick up a saved handoff in a fresh context. Use when the user asks to pick
  up or resume where they left off, or when the session start says a handoff
  waits for this project.
---

Find the handoff file, where `<handoffs dir>` is `$ALEPH_HANDOFFS_DIR` if set, else `~/.aleph/handoffs`:

- With an argument `<name>`: `<handoffs dir>/<name>.md`.
- With no argument: the project's handoff, `<handoffs dir>/projects/!`d=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && basename "$(dirname "$d")" || basename "$PWD"`.md`. `<scope>` is that name: the main repo's directory, or the current directory outside git.

If the session start already holds the handoff text, use it and skip the Read. Otherwise read the file in full. If it does not exist, say so and stop. Do not guess.

Treat the contents as authoritative session context: the **Intent** is the user's goal, the **State** is ground truth, the **Active plan** is your plan unless you have a strong reason to revise it, and the **Resume instructions** are your directive.

Before taking any action the handoff tells you to take:

1. Verify the state described still matches reality. When the session start holds the handoff text and the git output, use that output and run no git command. Otherwise run `git status` and `git log -5`. Check that referenced files still exist and contain what the handoff claims, confirm any servers or processes are still running if relevant. If reality has drifted from the handoff, surface the drift to the user before proceeding.
2. Archive the handoff so it isn't picked up twice: move it to `<handoffs dir>/$(date +%Y-%m-%d-%H%M%S)-<name>.md`, where `<name>` is the argument or `<scope>`. The date comes first because `vault compile` reads a day's handoffs by that prefix.

Then follow the **Resume instructions**. Lead with one sentence telling the user what you're picking up and what you're about to do. They may have switched contexts too.
