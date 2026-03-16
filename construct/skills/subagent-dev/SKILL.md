---
name: subagent-dev
description: Use when executing multi-task implementation plans with independent tasks. Fresh subagent per task with two-stage review (spec compliance then code quality).
---

# Subagent-Driven Development

Execute plans by dispatching a fresh subagent per task, with two-stage review after each.

**Grounding:** SOUL.md values — *Autonomy with accountability* (agents act independently, reviews ensure quality). Mental model — *Blast radius* (isolated subagents can't corrupt main context).

## When to Use

- Have an implementation plan with 2+ independent tasks
- Tasks can be understood without shared mutable state
- Want fast iteration without human-in-loop between tasks

## When NOT to Use

- Tasks are tightly coupled (fix one affects others)
- Need to maintain conversation context across tasks
- Single task — just do it directly

## The Process

### 1. Load Plan and Create Tasks

Read the plan. Extract all tasks with full text. Create TaskCreate entries for tracking.

### 2. Per Task: Implement → Review Spec → Review Quality

For each task:

**Dispatch implementer subagent:**
- Provide: task description, relevant file paths, constraints, expected output
- Never pass your full session history — construct exactly what the agent needs
- Agent implements, tests, and commits

**Dispatch spec reviewer subagent:**
- Provide: the original task spec + the diff the implementer produced
- Question: "Does this implementation satisfy every requirement in the spec?"
- If gaps found → implementer fixes, re-review

**Dispatch quality reviewer subagent:**
- Provide: the diff + project conventions (from STYLE.md)
- Question: "Any quality issues? DRY/YAGNI violations? Missing edge cases?"
- If issues found → implementer fixes, re-review

### 3. Mark Complete

After both reviews pass, mark task complete. Move to next task.

## Model Selection

Use the least powerful model that handles each role:

| Role | Complexity signal | Model |
|------|------------------|-------|
| Implementer | 1-2 files, clear spec | haiku |
| Implementer | Multi-file, integration | sonnet |
| Spec reviewer | Always | haiku |
| Quality reviewer | Always | sonnet |
| Architecture/design | Broad codebase understanding | opus |

## Key Rules

- **Fresh context per agent** — never inherit session history
- **One task per agent** — don't batch unrelated work
- **Two-stage review is mandatory** — spec compliance first, then quality
- **Stop on repeated failures** — if review fails 3 times, escalate to human
- **Verify before claiming done** — use verification skill after all tasks complete
