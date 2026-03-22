---
name: subagent-dev
description: Use when executing multi-task implementation plans with independent tasks. Fresh subagent per task with two-stage review.
---

# Subagent-Driven Development

Execute plans by dispatching a fresh subagent per task, with two-stage review after each.

## When to Use

- Have an implementation plan with 2+ independent tasks
- Tasks can be understood without shared mutable state
- Want fast iteration without human-in-loop between tasks

## When NOT to Use

- Tasks are tightly coupled (fix one affects others)
- Need to maintain conversation context across tasks
- Single task — just do it directly

## Inputs

- An implementation plan with discrete tasks. If no plan exists, create one first.

## Process

### 1 — Load plan and create tasks

Read the plan. Extract all tasks with full text. Create task entries for tracking.

### 2 — Per task: implement → review spec → review quality

**Dispatch implementer subagent:**
- Provide: task description, relevant file paths, constraints, expected output
- Never pass full session history — construct exactly what the agent needs
- Agent implements, tests, and commits

**Dispatch spec reviewer subagent:**
- Provide: the original task spec + the diff the implementer produced
- Question: "Does this implementation satisfy every requirement in the spec?"
- If gaps found → implementer fixes, re-review

**Dispatch quality reviewer subagent:**
- Provide: the diff + project conventions
- Question: "Any quality issues? DRY/YAGNI violations? Missing edge cases?"
- If issues found → implementer fixes, re-review

### 3 — Handle status

Implementer agents report one of four outcomes:

| Status | Action |
|--------|--------|
| DONE | Proceed to reviews |
| DONE_WITH_CONCERNS | Read flagged concerns before reviewing |
| NEEDS_CONTEXT | Provide missing information, re-dispatch |
| BLOCKED | Structural issue — expand context, decompose task, or escalate |

### 4 — Mark complete

After both reviews pass, mark task complete. Move to next task.

## Model Selection

| Role | Complexity signal | Model |
|------|------------------|-------|
| Implementer | 1-2 files, clear spec | haiku |
| Implementer | Multi-file, integration | sonnet |
| Spec reviewer | Always | haiku |
| Quality reviewer | Always | sonnet |
| Architecture/design | Broad codebase understanding | opus |

## Done when

- All tasks from the plan implemented
- Every task passed both spec review and quality review
- No task failed review more than twice (escalate on third failure)
- All tasks marked complete in tracking

## Chains to

- `finishing-branch` — after all tasks pass, merge or PR

## Principles

- Fresh context per agent — never inherit session history
- One task per agent — don't batch unrelated work
- Two-stage review is mandatory — spec compliance first, then quality
- Stop on repeated failures — if review fails 3 times, escalate to human
- Verify before claiming done — use verification skill after all tasks complete
