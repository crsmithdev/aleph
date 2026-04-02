---
name: ralph-loop
description: Use when a task needs iterative autonomous work — building features, getting tests to pass, batch processing, or any well-defined goal with clear completion criteria.
compatibility: Designed for Claude Code
---

# Ralph Loop

Named after Ralph Wiggum — kind of dumb, kind of lovable, and he never gives up. Ralph loops are autonomous iterative development: each iteration gets fresh context but sees all previous work in files and git history.

## When to Use

- Well-defined tasks with clear, testable completion criteria
- Tasks requiring iteration and refinement (getting tests to pass, building features)
- Batch processing where each unit of work is independent
- Greenfield work where you can let agents run unattended
- Tasks with automatic verification (tests, linters, type checks)

## When NOT to Use

- Tasks requiring human judgment or design decisions mid-stream
- One-shot operations (just do them directly)
- Tasks with unclear or subjective success criteria
- Production debugging (use the debugging skill instead)

## Inputs

- Clear completion criteria (testable, not subjective)
- Known output location for progress artifacts

## Process

Iterations are dispatched as subagents. Parallel by default — if iterations don't depend on each other, dispatch them all at once in a single message.

- **Independent work** (batch, research, ideation) → all iterations as parallel background agents
- **Sequential work** (test-fix cycles, refinement) → dispatch one, read output, dispatch next
- **Mixed** → group independent work into parallel batches, run batches sequentially

## Done when

- All completion criteria met with fresh verification evidence
- No iterations still running or pending
- Completion promise is honest — never claim done if any criterion is unmet

## Principles

- Progress lives in files — not in context windows. Each agent writes to a known output location.
- Failures are data — if an agent fails, its output explains why; the next agent can learn from it
- Completion promise is sacred — never claim completion unless all iterations are genuinely done
