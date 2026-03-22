---
name: parallel-agents
description: Use when investigating 3+ independent failures or problems that don't share state. Dispatch one agent per problem domain.
---

# Parallel Agent Dispatch

## When to Use

- 3+ test failures with different root causes across different files
- Multiple independent problems that can be investigated concurrently
- Each problem can be understood without context from the others

## When NOT to Use

- Failures are likely related (fixing one may fix others)
- Need complete system understanding before investigating any part
- Exploratory debugging where the problem is unclear
- Fewer than 3 independent problems (just do them sequentially)

## Process

### 1 — Group by domain

Identify independent problem domains. Each domain should map to a specific subsystem, test file, or component.

### 2 — Craft focused prompts

Each agent receives:
- **Scope** — exactly which files/tests to investigate
- **Goal** — what to fix or determine
- **Constraints** — what NOT to touch (prevent agents from conflicting)
- **Output format** — what to report back

Do not pass session history. Construct the minimum context each agent needs.

### 3 — Dispatch all at once

Send all agent dispatches in a single message for true parallelism. Serial dispatch defeats the purpose.

### 4 — Integrate results

- Read all agent summaries
- Check for conflicts (did two agents modify the same file?)
- Run the full test suite to verify combined fixes
- Resolve any integration issues

## Done when

- All agents have reported back
- Results checked for conflicts
- Full test suite passes after integrating all fixes

## Principles

- Independent problems only — shared state means sequential investigation
- All agents in one message — serial dispatch is a failure mode
- Verify the combination — individual fixes may conflict when merged
