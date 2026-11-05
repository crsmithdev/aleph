---
name: handoff
description: >
  Save a session handoff so a fresh context can resume the work. Use when the
  user asks for a handoff, or when context is about to be cleared mid-task.
---

Write a complete handoff for the next session. The next session will read this verbatim with no other context. Assume the reader knows nothing about what we've been doing.

- With an argument `<name>` (the Sidetone bridge passes `sidetone`): write `~/.aleph/handoffs/<name>.md`.
- With no argument: write the project's handoff, `~/.aleph/handoffs/projects/<scope>.md`. `<scope>` is the name of the main repo's directory, or of the current directory outside git:

  ```
  d=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && basename "$(dirname "$d")" || basename "$PWD"
  ```

Create the directory first if it doesn't exist (`mkdir -p`).

The first line of the file is `summary: <what the next session does, in one line of at most 100 characters>`. The session start shows this line to the user.

Then the file must contain these sections, in this order:

## Intent
One short paragraph: what is the user trying to accomplish in this thread, and why. Include the original ask if it's still load-bearing.

## State
What's been done so far. What's in progress. What's blocked or unresolved. Be specific: name files, branches, PRs, ticket IDs, function names, line numbers. A reader should be able to `git status` / `git log` and have your description match reality.

## Active plan
If there's a plan in play (a plan file, a task list, or an informal plan in the conversation), reproduce it in full here. Do not summarize. If there's no active plan, write "None".

## Open questions
Anything the user has not yet answered, decisions deferred, or things you'd ask if they were still in the room.

## Resume instructions
A single paragraph addressed to the next instance of yourself. Tell it: where to start reading (specific file paths, line ranges), what to verify before doing anything (e.g. "check that branch X is still checked out", "restart the dev server on a free port"), and what the next concrete action is. Be directive, "do X, then Y", not advisory. Write it so the next session can act without re-asking the user.

After writing the file, output exactly this and nothing else. With no argument:

> Handoff saved to `~/.aleph/handoffs/projects/<scope>.md`. Run `/clear`; the next session picks it up on your first prompt.

With an argument, a program starts the next session, so output only:

> Handoff saved to `~/.aleph/handoffs/<name>.md`.
