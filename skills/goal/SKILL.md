---
name: goal
description: >
  Turn a goal of one or two sentences into a goal issue for the factory: a
  short product-level grill, then one issue and its goal in the work store.
  Use when Chris runs /aleph:goal or asks the factory to build something.
  NOT for: a design tree (use /aleph:grill-me), a spec (use /aleph:to-spec).
---

The factory (`docs/specs/2026-10-26-seed-factory.md`) runs one sandboxed
worker per open goal, with no plan stage and nobody to ask. The issue
is all the worker gets, so it must say what done is and how to check it.

## 1. Read before you ask

Find the repo (default: the current one, if the factory tracks it)
and read what the goal touches: the files, `git log` on them, and the open
issues (`aleph issue list <repo>`). If the goal is an existing issue, read it
with `aleph issue show <repo> <n>`: the run edits that issue, not a new one.

Find facts yourself. When the oracle needs a fact from the web (a price, a
version, an API's shape), fetch it now, in this session: the sandbox has no
web. Put the value and its source URL in the recommended answer.

## 2. Ask, with one AskUserQuestion call

Ask at most four questions, all in one call. Each has 2-4 options, and
exactly one is first and marked "(Recommended)". Ask only what changes the
issue; take the rest from the code.

- **Goal**: the end state, as Chris would check it.
- **Edit surface**: the files or folders the run may change.
- **Oracle**: the check that proves it, which the worker cannot edit: a new
  test that asserts the end state, a command whose output proves it, or a
  value with its source URL. The factory runs the repo's checks from
  `~/.aleph/repos.json` after every run, so an oracle names only real
  commands, for example `bun test <file>`, never a command that does not
  exist, such as `aleph check`. Acceptance does not run an Oracle command with a
  placeholder such as `<file>`, so the Oracle names the real path. "The tests
  pass" alone is not an oracle.
- **Time box**: default 40 minutes and one run.

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

## Time box
<minutes>, one run.

## Defaults taken
- <question>: <answer>   (only the questions answered by default)
```

A new goal:

```
aleph issue add <repo> "<title>" --goal - --priority high <<'BODY'
...
BODY
```

The text on stdin is the goal; the command files the issue and its goal `.1`
in one commit, and no triage run starts. When the goal runs after another, add
`--after <goal id>`. An existing issue stays as it is: file the goal as a new
issue with the command above and put a note on the old one.

Then say the goal number (`<repo>-<n>.1`) and that the next timer tick (every 30 minutes)
starts the run. `aleph report` at the next session start shows the result,
and the worker's `DEFAULT:` lines show the questions it answered itself.
