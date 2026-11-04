---
name: goal
description: >
  Turn a goal of one or two sentences into a goal issue for the factory: a
  short grill, then one issue with its spec in the work store. Use when Chris
  runs /aleph:goal. It is optional: items also come from the browser, triage
  and the chat, without a grill.
  NOT for: a design tree (use /aleph:grill-me), a spec (use /aleph:to-spec).
---

The factory (`docs/specs/2026-10-26-seed-factory.md`) runs one
worker per open issue with a spec, with nobody to ask; a planner splits a large
goal first. The issue is all the worker gets, so it must say what done is and
how to check it.

## 1. Read before you ask

Find the repo (default: the current one, if the factory tracks it)
and read what the goal touches: the files, `git log` on them, and the open
issues (`aleph issue list <repo>`). If the goal is an existing issue, read it
with `aleph issue show <repo> <n>`: the run edits that issue, not a new one.

Find facts yourself. When the oracle needs a fact from the web (a price, a
version, an API's shape), fetch it now, in this session, so the worker does not
guess it. Put the value and its source URL in the recommended answer.

## 2. Ask, with one AskUserQuestion call

Ask at most four questions, all in one call. Each has 2-4 options, and
exactly one is first and marked "(Recommended)". Ask only about the product:
what it must do, for whom, what good looks like and what it must not do. Work
out the Edit surface yourself and write it into the issue.
Propose the Oracle yourself, and ask only when the end state has more than one
reasonable check.

- **Goal**: the end state, as Chris would check it.
- **Edit surface**: the files or folders the run may change.
- **Oracle**: the check that proves the end state. Verify runs only commands
  in backticks that start with `bun test`, `bun run` or `bunx tsc`, so name
  one of those when the repo can. The Oracle is stored on the issue, and the
  worker sees it and can run it: a command whose output proves it, or a value
  with its source URL. The Oracle does not ask for a new committed test. A
  committed test needs a lasting reason: a bug fix gets one regression test at
  the lowest layer; new lasting module behaviour gets a row in the module's
  existing test file; a CLI end-to-end test is only for new command wiring. The
  factory runs the repo's checks from `~/.aleph/repos.json` after every run, so
  an Oracle names only real commands, for example `bun test <file>`, never a
  command that does not exist, such as `aleph check`. Name the real path, not
  a placeholder such as `<file>`. "The tests pass" alone is not an oracle.

If Chris answers "use your defaults", take every recommended answer. Write
no issue while a question is open.

## 3. Write the issue

The body has these sections, each non-empty:

```
## Goal
<the end state>

## Edit surface
<paths>

## Oracle
<the check; a web fact with its value and URL>

## Defaults taken
- <question>: <answer>   (only the questions answered by default)
```

The title is an imperative of at most 60 characters that says what changes, not how, with no final period and no `<words>: ` prefix (`TITLE_RULE` in `todo/lib/todo.ts`). When the work is part of a larger group, it opens with the group in brackets: `[<group>] <title>`. A bug keeps its symptom inside the imperative: "Fix Status Week per issue showing 0.0%". `--kind` says what the issue is: `task` (the default), `bug`, `check`, `flake` or `proposal`.

A new goal:

```
aleph issue add <repo> "<title>" --spec - --priority high <<'BODY'
...
BODY
```

The text on stdin is the spec; the command files the issue with it in one
commit, and no triage run starts. When it runs after another, add
`--after <id>`. An existing issue takes a spec with
`aleph issue edit <repo> <id> --spec -`.

Then say the issue number (`<repo>-<n>`) and that the dispatch starts the run at once. `aleph report` at the next session start shows the result,
and the worker's `DEFAULT:` lines show the questions it answered itself.
