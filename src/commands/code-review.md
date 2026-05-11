---
description: Review code for issues then refactor — review phase produces findings, refactor phase executes approved fixes
---
Run a code review and optional refactor. Parse scope and intent from: $ARGUMENTS

## Phase 1: Review

Launch the `code-architect` agent to review the specified scope:

```
Agent(subagent_type="code-architect", prompt="Review [scope]. [any additional instructions from $ARGUMENTS]")
```

If no scope is given in `$ARGUMENTS`, default to the recent diff (`git diff HEAD~1`).

The reviewer will produce a prioritized findings list (Critical / Important / Minor) and save it to a file. **Do not proceed to Phase 2 until the user approves which findings to fix.**

## Phase 2: Refactor (after approval)

Once the user specifies which findings to address, launch the `code-refactor` agent:

```
Agent(subagent_type="code-refactor", prompt="Fix the following approved findings from the review: [approved list]. Review file: [path]. [any additional context]")
```

The refactor agent handles all file moves, import updates, and structural changes with zero breakage.

## Scope examples

| `$ARGUMENTS` | Scope passed to reviewer |
|---|---|
| (empty) | `git diff HEAD~1` |
| `src/foo/` | the `src/foo/` directory tree |
| `the auth module` | files related to auth |
| `everything` | all source files under `src/` |
