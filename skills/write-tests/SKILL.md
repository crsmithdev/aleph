---
name: write-tests
description: >
  TDD, test-first: red before green, one vertical slice at a time. Use when
  the user wants to build a feature or fix a bug test-first, or wants
  integration tests. NOT for: auditing a test suite (use refit-tests).
---

Adapted from Matt Pocock's `tdd` skill (github.com/mattpocock/skills @4ae2317).

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, and the rules of the loop. [RULES.md](./RULES.md) holds the rules a test must meet. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, read the [glossary](../domain-modeling/SKILL.md) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

Before you mock, read [mocking.md](mocking.md). When unsure whether a test is good, compare it with [tests.md](tests.md).

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam. You can't test everything, so agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

Ask: "What's the public interface, and which seams should we test?" Give each proposed seam a one-line note on what it catches and what it misses.

When the shape of that interface is itself in question (how deep the module is, where the seam belongs, what the interface should expose), call the Skill tool with `aleph:codebase-design` for the vocabulary. It is the shared source of the module, interface, depth, seam, adapter, leverage and locality terms, and it is a reference to consult, not a session to run.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **Red is a run, not a plan.** Done when you have run the new test and seen it fail for the reason you expect (show the command and the failure line). Write no implementation before that run.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Check the tests.** Before the first cycle, call the Read tool on [RULES.md](./RULES.md) and [write/PROCESS.md](../write/PROCESS.md). After the last cycle, run PROCESS.md's step 5 on the tests you wrote.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.
