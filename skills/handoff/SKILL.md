---
name: handoff
description: Save a session handoff to ~/.aleph/handoffs/current.md so a fresh context can pick up where this one left off. Use when the user says "handoff", "save a handoff", "write a handoff", "/handoff", or when context is about to be cleared mid-task.
---

Write a complete handoff for the next session to `~/.aleph/handoffs/current.md`. The next session will read this verbatim with no other context. Assume the reader knows nothing about what we've been doing.

Create the directory first if it doesn't exist (`mkdir -p ~/.aleph/handoffs`).

The file must contain these sections, in this order:

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

After writing the file, output exactly this and nothing else:

> Handoff saved to `~/.aleph/handoffs/current.md`. Run `/clear` then `/aleph:pickup` in the new session.
