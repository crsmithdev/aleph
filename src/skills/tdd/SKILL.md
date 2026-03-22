---
name: tdd
description: Use when writing new features, fixing bugs, or changing behavior. RED-GREEN-REFACTOR cycle. No production code without a failing test first.
---

# Test-Driven Development

## When to Use

- New features, bug fixes, behavior changes
- Any code that should be tested (most code)

## When NOT to Use

- Throwaway prototypes (with explicit human approval)
- Generated code, config files, documentation
- Pure refactoring where existing tests already cover behavior

## Process

### The Iron Law

**No production code without a failing test first.** Code written before its test must be deleted and rewritten.

### RED-GREEN-REFACTOR

1. **RED** — Write one minimal failing test for the next behavior
2. **Verify RED** — Run it. Watch it fail. If it passes, the test is wrong.
3. **GREEN** — Write the simplest code that passes the test
4. **Verify GREEN** — Run all tests. Zero failures.
5. **REFACTOR** — Clean up while tests stay green. Commit.

Repeat for each behavior.

### Test Quality

- One behavior per test — if the name has "and", split it
- Name describes behavior, not implementation: `rejects expired tokens` not `tests validateToken`
- Use real code, not mocks, unless the dependency is slow/external/non-deterministic
- Assert on observable output (return values, side effects, errors), not internal state

### Stop Conditions

Restart from RED if you catch yourself:
- Writing production code before a failing test exists
- Writing multiple tests before making any pass
- Skipping verify-RED ("I know it'll fail")
- Making a test pass by hardcoding the expected value
- Writing a test after the code (it proves nothing — you don't know if it can fail)

### Common Rationalizations

| Thought | Reality |
|---------|---------|
| "This is too simple to test" | Simple code has the most surprising edge cases |
| "I'll write tests after" | Tests written after pass immediately — they prove nothing |
| "Just this once" | Discipline is what you do every time, not most times |
| "The tests are slowing me down" | Wrong tests slow you down. Good tests speed you up. |
| "I need to see the shape first" | Write a test that describes the shape you want |

## Done when

- Every new function/method has a test written before the implementation
- Every test was observed to fail before its implementation existed
- All tests pass
- Edge cases (empty input, boundaries, errors) are covered

## Principles

- Watch the test fail — if you didn't see it fail, you don't know it tests the right thing
- Simplest code to pass — resist the urge to generalize before the tests demand it
- Refactor only on green — never change structure with failing tests
- Tests are specification — they document what the code does, not how
