---
name: ralph-loop
description: Use when a task needs iterative autonomous work — building features, getting tests to pass, batch processing, or any well-defined goal with clear completion criteria. Always execute iterations via parallel subagents, not the Stop hook loop.
---

# Ralph Loop

Autonomous iterative development. Each iteration gets fresh context but sees all previous work in files and git history.

**Grounding:** SOUL.md values — *Autonomy with accountability* (loop runs autonomously, completion promise enforces honesty). Mental model — *Blast radius* (each iteration is isolated; progress persists in filesystem, not context).

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
- Production debugging (use the `debugging` skill instead)

## Execution: Always Use Subagents

Ralph iterations MUST be dispatched as parallel subagents, not as a Stop hook loop. The Stop hook loop blocks the conversation and burns context. Subagents run concurrently, each with a full context window.

### For independent iterations (batch work, research, ideation):

Dispatch all iterations as parallel subagents in a single message. Each agent gets the full prompt plus its iteration number and any iteration-specific context.

```
Agent(prompt="Iteration 3/10: {task}. Check /output/ for work from other iterations. Write your result to /output/03-name.md", run_in_background=true)
```

### For sequential iterations (test-fix cycles, refinement):

Dispatch the first iteration. When it completes, read its output, then dispatch the next with the accumulated context. Use `isolation: "worktree"` if iterations modify the same files.

### For mixed patterns:

Group independent work into parallel batches. Run batches sequentially when later batches depend on earlier results.

## Key Principles

- **Parallel by default** — if iterations don't depend on each other, dispatch them all at once
- **Progress lives in files** — not in context windows. Each agent writes to a known output location.
- **Failures are data** — if an agent fails, its output explains why; the next agent can learn from it
- **Completion promise is sacred** — NEVER claim completion unless all iterations are genuinely done

## The Stop Hook (legacy fallback)

The `/construct ralph` command and `ralph-stop.ts` Stop hook still exist for cases where the Stop hook pattern is explicitly needed (e.g., long-running single-threaded work that must survive context resets). But the default execution strategy is always subagents.

## Commands

- `/construct ralph "prompt" [--max-iterations N] [--completion-promise "TEXT"]` — start via Stop hook (legacy)
- `/construct cancel-ralph` — cancel active Stop hook loop
