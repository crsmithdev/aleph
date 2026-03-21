---
name: brainstorming
description: Use when exploring approaches to a problem, designing before implementing, or when multiple valid solutions exist. Design-first workflow with approval gates.
---

# Brainstorming

Design before you build. Simple projects are where unexamined assumptions waste the most time.

## When to Use

- Multiple valid approaches exist and the right one isn't obvious
- New feature or system design before implementation
- User asks to explore, propose, or compare approaches

## When NOT to Use

- The approach is obvious and the user wants execution, not discussion
- QUICK-depth tasks (≤2 files, deterministic outcome)
- You're already mid-implementation with an approved plan

## Process

1. **Explore context** — read relevant code, docs, and constraints
2. **Ask clarifying questions** — one at a time, not a list
3. **Propose 2-3 approaches** — each with trade-offs, not just pros
4. **Present design** — scale to complexity: a few sentences for small work, full sections for architecture
5. **User approves** — do not proceed to implementation without approval
6. **Write design doc** (if non-trivial) — capture decisions for the plan phase

### Common Rationalizations

| Thought | Reality |
|---------|---------|
| "This is simple, skip design" | Simple projects have the most unexamined assumptions |
| "I already know the right approach" | Then it takes 30 seconds to confirm. Do it. |
| "The user wants speed, not process" | Wrong design at full speed is slower than right design at half speed |

## Done when

- User has approved an approach
- Trade-offs are stated, not hidden
- Design is captured (in conversation for small work, in a doc for large)

## Principles

- Present options, don't prescribe — the user decides
- Trade-offs over recommendations — show the cost of each path
- Scale to complexity — don't over-design a two-line change

## Chains to

- `writing-plans` — after design is approved, create an implementation plan
