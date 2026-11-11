---
name: handoff
description: >
  Save a session handoff so a fresh context can resume the work. Use when the
  user asks for a handoff, or when context is about to be cleared mid-task.
effort: low
---

Write a handoff for the next session. The next session reads it with no other context.

Path, where `<handoffs dir>` is `!`echo "${ALEPH_HANDOFFS_DIR:-$HOME/.aleph/handoffs}"``:

- With an argument `<name>` (the Sidetone bridge passes `sidetone`): `<handoffs dir>/<name>.md`.
- With no argument: `<handoffs dir>/projects/!`d=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && basename "$(dirname "$d")" || basename "$PWD"`.md`.

Speed matters: the user waits for this file.

- Write from what this conversation already knows. Run no commands to check state before you write. `/aleph:pickup` checks git and files before it acts.
- Write the file in one Write call. The Write tool makes the directory.
- Keep it short: at most 60 lines. Name files, branches, commits and issue numbers; do not restate what `git log` or an issue already says. Leave out a section that has nothing in it.

The first line of the file is `summary: <what the next session does, in one line of at most 100 characters>`. The session start shows this line to the user.

With an argument, the second line is `cwd: !`pwd``. The session start picks up a named handoff in a session that starts in that directory or below it.

Then these sections, in this order:

## Intent
One short paragraph: what the user is trying to do in this thread, and why. Include the original ask if it is still load-bearing.

## State
What is done, what is in progress, what is blocked. Be specific: files, branches, worktrees, issue numbers, function names.

## Active plan
The plan in play. If it lives in a file, give the path and the step reached. If it lives only in this conversation, reproduce its remaining steps in full.

## Open questions
What the user has not answered, and decisions deferred.

## Resume instructions
One paragraph to the next instance of yourself: where to start reading, what to verify first, and the next concrete action. Be directive: "do X, then Y".

After writing the file, with no argument, output nothing: a hook ends the turn and shows the user the next step.

With an argument, a program starts the next session, so output only:

> Handoff saved to `<path>`.
