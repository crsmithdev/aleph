---
name: build
description: Use when implementing features, fixing bugs, or making multi-file changes. Single orchestrator that handles design, planning, TDD execution, and integration.
---

# Build

One skill for the full implementation lifecycle. Phases are inline — no chaining, no handoffs.

## When to Use

- New features, bug fixes, refactors involving 3+ files
- Any FULL-depth task (multi-file, architectural decision, uncertain scope)
- User asks to build, implement, add, create, or fix something non-trivial

## When NOT to Use

- QUICK-depth tasks (≤2 files, deterministic outcome) — just do it
- Pure investigation or research — use `research`
- Pure review — use `code-review`

## Phases

### 1 — Design (skip if obvious)

Skip this phase when the approach is obvious and there's only one sensible path.

- Read relevant code, docs, constraints
- Ask one clarifying question at a time (not a list)
- Propose 2-3 approaches with trade-offs (not just pros)
- Get user approval before proceeding

### 2 — Plan

Map every file that will be created or modified. Break into tasks:

- One logical unit per task (a route, a component, a service method)
- Each task includes: file paths, test-first steps, success criteria
- Order by dependency (schema before service, service before route)
- Mark independent tasks for parallel execution

```
## Tasks
### Task 1: [name]
Files: `path/to/file.ts`
- [ ] Write test for [behavior]
- [ ] Verify test fails
- [ ] Implement [change]
- [ ] Verify all tests pass
- [ ] Commit
```

### 3 — Execute

For each task, follow the TDD cycle strictly:

1. **RED** — Write one failing test for the next behavior
2. **Verify RED** — Run it. If it passes, the test is wrong.
3. **GREEN** — Write the simplest code that passes
4. **Verify GREEN** — All tests pass. Zero failures.
5. **REFACTOR** — Clean up on green. Commit.

**Dispatch strategy:**
- Every Agent call MUST include `isolation: "worktree"` — no exceptions
- Independent tasks → parallel subagents (one task per agent, fresh context, no session history)
- Sequential/coupled tasks → inline via `/inline`, one at a time
- Use haiku for simple 1-2 file tasks, sonnet for multi-file integration
- The main session orchestrates — it reads, plans, dispatches, and reviews. It never edits files directly.

**Stop on blockers.** Do not guess. Do not work around. Flag and wait.

### 4 — Review

After all tasks complete, run two checks:

1. **Spec compliance** — does the implementation satisfy every requirement?
2. **Quality** — DRY/YAGNI violations, missing edge cases, style issues?

Fix before proceeding.

### 5 — Verify

Run the full test suite. Use the `verification` skill. No green, no merge.

### 6 — Commit

Commit all changes on the feature branch. Every logical unit from the Execute phase should already be committed individually; this final commit captures any remaining Review/Verify fixes.

### 7 — Finish

Use the `finishing-branch` skill: verify → merge / PR / keep / discard.

## Test Quality

- One behavior per test — if the name has "and", split it
- Name describes behavior: `rejects expired tokens` not `tests validateToken`
- Real code over mocks unless the dependency is slow/external/non-deterministic
- Assert on observable output, not internal state

## Stop Conditions

Restart from RED if you catch yourself:
- Writing production code before a failing test exists
- Skipping verify-RED ("I know it'll fail")
- Writing a test after the code

## Isolation Rules

The main session is an orchestrator. All file modifications go through subagents in worktrees.

- **Main session**: Read, Grep, Glob, Bash (read-only), Agent, TaskCreate/Update — no Edit, no Write
- **Subagents**: Edit, Write, Bash (all) — always in worktrees via `isolation: "worktree"`
- **Override**: `/inline` disables the dispatch gate for the current session when inline work is genuinely needed

The dispatch-pre-require-subagent hook enforces this — Edit/Write in the main session will be blocked unless `/inline` is active.

## Done when

- Every task implemented, tested, committed
- Both reviews passed (spec + quality)
- Full test suite green
- Branch integrated via `finishing-branch`

## Principles

- Design scales to complexity — don't over-design a two-line change
- Plan is a guide, not a prison — if reality conflicts, flag and adjust
- Watch the test fail — if you didn't see it fail, you don't know it works
- Fresh context per subagent — never inherit session history
- Stop on repeated failures — escalate to human on third review failure
