---
name: executing-plans
description: Use when executing a written implementation plan inline (not via subagents). Task-by-task with verification checkpoints.
---

# Executing Plans

## When to Use

- Have a written plan and want to execute it directly (not via subagents)
- Tasks are sequential or tightly coupled
- Prefer staying in one context over dispatching agents

## When NOT to Use

- Tasks are independent — use `subagent-dev` instead for parallelism
- No plan exists — use `writing-plans` first
- Single task — just do it directly

## Process

### 1 — Load and review

Read the plan. Flag anything that looks wrong before starting — don't discover problems mid-execution.

### 2 — Execute each task

For each task in order:
1. Mark task in-progress
2. Follow steps exactly (TDD cycle: test → verify fail → implement → verify pass)
3. Run specified verification commands
4. Commit
5. Mark task complete

### 3 — Stop on blockers

Stop immediately when:
- A dependency is missing
- A test fails unexpectedly
- An instruction is unclear
- The plan conflicts with what you find in the code

Do not guess. Do not work around. Flag the blocker and wait.

### 4 — Verify completion

After all tasks: run the full test suite. Use the `verification` skill.

## Done when

- Every task in the plan is marked complete
- Every verification command has been run with passing output
- Full test suite passes
- No blockers were worked around (all were resolved or flagged)

## Principles

- Plan is a guide, not a prison — if reality conflicts, flag it and adjust
- Stop on blockers — guessing causes more damage than pausing
- Verify after every task, not just at the end

## Chains to

- `finishing-branch` — after all tasks pass, merge or PR
