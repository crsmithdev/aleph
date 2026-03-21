---
name: writing-plans
description: Use when a task needs an implementation plan before execution. Breaks work into testable tasks with file mappings and TDD steps.
---

# Writing Plans

## When to Use

- Multi-file changes that benefit from upfront task decomposition
- Work that will be executed by subagents (they need explicit instructions)
- Complex features where order of operations matters

## When NOT to Use

- Single-file changes with obvious implementation
- QUICK-depth tasks
- You're already executing — finish first, don't re-plan mid-stream

## Process

### 1 — Map files

List every file that will be created or modified, with a one-line description of what changes.

### 2 — Break into tasks

Each task should be completable in one focused pass:
- One logical unit of work (a route, a component, a service method)
- Follows TDD: write failing test → verify failure → implement → verify pass → commit
- Includes exact file paths and expected commands with output
- Can be understood without reading other tasks (self-contained context)

### 3 — Order tasks

- Dependencies first (schema before service, service before route)
- Independent tasks can be marked for parallel execution

### 4 — Review

Read the plan critically before executing:
- Does each task have clear success criteria?
- Are dependencies ordered correctly?
- Could any tasks run in parallel?

### Plan Format

```markdown
# Plan: [feature name]

## Goal
[One sentence]

## Files
- `path/to/file.ts` — [what changes]

## Tasks

### Task 1: [name]
Files: `path/to/file.ts`
- [ ] Write test for [behavior]
- [ ] Verify test fails
- [ ] Implement [change]
- [ ] Verify all tests pass
- [ ] Commit

### Task 2: [name] (parallel with Task 1)
...
```

## Done when

- Every file change is accounted for in at least one task
- Every task has testable completion criteria
- Task ordering respects dependencies
- Plan reviewed for gaps before execution begins

## Principles

- Granular over ambitious — small tasks that obviously work beat large tasks that might
- Self-contained tasks — each task includes all context an agent needs
- TDD baked in — every task includes the test-first cycle

## Chains to

- `subagent-dev` — dispatch one agent per task with two-stage review
- `executing-plans` — execute tasks inline with checkpoints
