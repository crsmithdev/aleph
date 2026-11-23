---
name: pickup
description: >
  Pick up a saved handoff in a fresh context. Use when the user asks to pick
  up or resume where they left off, or when the session start says a handoff
  waits for this project.
argument-hint: "[<name or path>]"
allowed-tools: Bash(printenv:*), Bash(git rev-parse:*), Bash(pwd)
---

This session's values. An empty value means the variable is not set.

- `ALEPH_HANDOFFS_DIR`: !`printenv ALEPH_HANDOFFS_DIR || true`
- Git common dir: !`git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true`
- `HERDR_ENV`: !`printenv HERDR_ENV || true`
- `HERDR_PANE_ID`: !`printenv HERDR_PANE_ID || true`
- `HC_TERMINAL_ID`: !`printenv HC_TERMINAL_ID || true`
- Current folder: !`pwd`

`<handoffs dir>` is `ALEPH_HANDOFFS_DIR`, else `~/.aleph/handoffs`. `<repo>` is the name of the folder that holds the git common dir: the main repo's folder. Outside git, `<repo>` is the name of the current folder.

Find the handoff file:

- If `$ARGUMENTS` holds the path of a handoff file (it contains `/`), read that file. `<scope>` is the folder of the file under `projects/`, else the file name without `.md`.
- If `$ARGUMENTS` holds a name, that name is `<name>`: read `<handoffs dir>/<name>.md`.
- If `$ARGUMENTS` is empty inside Herdr (`HERDR_ENV=1` and `HERDR_PANE_ID` set), read this pane's handoff, `<handoffs dir>/projects/<scope>/<HERDR_PANE_ID>.md`.
- If `$ARGUMENTS` is empty inside the Herdr desktop app (`HC_TERMINAL_ID` set, and no Herdr pane), read this terminal's handoff, `<handoffs dir>/projects/<scope>/hc-<HC_TERMINAL_ID>.md`.
- If `$ARGUMENTS` is empty otherwise, read the project's handoff, `<handoffs dir>/projects/<repo>.md`.

With no argument, `<scope>` is `<repo>`: the main repo's directory, or the current directory outside git.

If the session start already holds the handoff text, use it and skip the Read. Otherwise read the file in full. If it does not exist, say so and stop. Do not guess.

Treat the contents as authoritative session context: the **Intent** is the user's goal, the **State** is ground truth, the **Active plan** is your plan unless you have a strong reason to revise it, and the **Resume instructions** are your directive.

Before taking any action the handoff tells you to take:

1. Verify the state described still matches reality. When the session start holds the handoff text and the git output, use that output and run no git command. Otherwise run `git status` and `git log -5`. Check that referenced files still exist and contain what the handoff claims, confirm any servers or processes are still running if relevant. If reality has drifted from the handoff, surface the drift to the user before proceeding.
2. Archive the handoff so it isn't picked up twice: move it to `<handoffs dir>/$(date +%Y-%m-%d-%H%M%S)-<name>.md`, where `<name>` is the name argument, else `<scope>`. The date comes first because `vault compile` reads a day's handoffs by that prefix.

Then follow the **Resume instructions**. Lead with one sentence telling the user what you're picking up and what you're about to do. They may have switched contexts too.
