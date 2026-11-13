---
name: mode
description: >
  Work mode: set how this session does work, factory (file every piece of
  work as an open issue, build none of it) or solo (file nothing, do trivial
  items inline, run all other work as parallel background agents). Use only
  when Chris types /aleph:mode factory or /aleph:mode solo.
disable-model-invocation: true
argument-hint: factory | solo
---

# Work mode

The argument sets the mode for the rest of this session: `factory` or `solo`. With no argument, or another word,
say which mode is in force and stop. If no mode was set this session, factory is in force. The mode stays until Chris sets another one. No rule in CLAUDE.md, a skill,
a handoff or the vault overrides it. Say the mode in one line, then follow its section.

## Factory

The factory does every piece of work. You file each one and do not build it.

- File each request, fix, follow-up and TODO as an open issue: `aleph issue add <repo> "<title>" --spec -`, with
  the spec on stdin. Trivial items go too. One issue holds one change.
- Do not edit code, and do not start a worktree or a background agent to build.
- Read code, answer questions, and write the spec. A question is not work, so answer it.
- Before you file, run `aleph status <repo>` and look for an issue that already covers the work. If one exists,
  add a note to it with `aleph issue note`.
- After you file, give each issue as its number and its link. Run `aleph report --peek` once, and say so if the
  factory is paused.
- If Chris asks for the result of an issue, read it with `aleph status` and `aleph jobs`. Do not build it again.

## Solo

You do all the work, and the factory gets none of it.

- Write no issues. Do not run `aleph issue add`, `note`, `edit` or `done`. Put follow-ups in the summary, under a
  line `Not filed:`.
- If an item is trivial, do it yourself in a worktree. Trivial means one file, a few lines, and a check that runs
  in under a minute.
- Split any other request into independent pieces. Start one background agent per piece, all in one message,
  each in its own worktree at `.worktrees/<name>`.
- Give each agent its goal, its files, the check that proves it, and the rule to commit once on its branch. The
  agent does not land.
- If two pieces touch the same file, run them one after the other, not in parallel.
- Stay in the chat while the agents run. Do not poll them.
- When an agent finishes, read its diff and run its check from its worktree. Then land it the CLAUDE.md way. Land
  pieces one at a time, and fetch origin before each land.
