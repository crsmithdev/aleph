---
name: debugging
description: Use when investigating bugs, fixing test failures, or troubleshooting unexpected behavior. Four-phase root cause methodology. No fixes without root cause first.
---

# Systematic Debugging

## When to Use

- Investigating bugs, fixing test failures, troubleshooting unexpected behavior
- Something worked before and now doesn't
- Error messages, crashes, or exceptions need root cause analysis

## When NOT to Use

- The problem is a known configuration issue with a documented fix
- You're exploring or researching, not fixing a specific failure

## Process

### Core Principle

**No fixes without root cause investigation first.** Never apply symptom-focused patches.

### Phase 1: Root Cause Investigation

Before touching any code:

1. **Read error messages thoroughly** — every word matters
2. **Reproduce consistently** — if you can't reproduce it, you can't verify a fix
3. **Examine recent changes** — what changed before this started failing?
4. **Trace data flow** — follow the call chain to where bad values originate

```
1. Observe symptom — where does the error manifest?
2. Find immediate cause — which code directly produces the error?
3. Ask "what called this?" — map the call chain upward
4. Keep tracing — follow invalid data backward through the stack
5. Find original trigger — where did the problem actually start?
```

Never fix where errors appear — trace to the original trigger.

### Phase 2: Pattern Analysis

1. **Find working examples** — similar code that works correctly
2. **Compare implementations** — don't skim, read fully
3. **Identify differences** — what's different between working and broken?
4. **Check dependencies** — what does this code depend on?

### Phase 3: Hypothesis and Test

One variable at a time:

1. **Formulate ONE hypothesis** — "the error occurs because X"
2. **Predict the outcome** — what should happen if hypothesis is correct?
3. **Run minimal test** — change ONE thing
4. **Compare prediction to result**
5. **Iterate or proceed** — refine if wrong, implement if right

### Phase 4: Implementation

1. **Create failing test** — captures the bug behavior
2. **Implement single fix** — address root cause, not symptoms
3. **Verify test passes** — use verification skill
4. **Run full test suite** — ensure no regressions

### Stop Conditions

**If 3+ consecutive fixes fail: STOP.** Architectural problem requiring discussion, not more patches.

**Stop immediately if thinking:**
- "Quick fix for now, investigate later"
- "One more fix attempt" (after multiple failures)
- "This should work" (without understanding why)
- "Let me just try..." (without hypothesis)

### Common Rationalizations

| Thought | Reality |
|---------|---------|
| "I know what's wrong" | Then state the hypothesis and test it. Skipping investigation costs more. |
| "Quick fix, then investigate" | The quick fix masks the root cause. Now you have two problems. |
| "It's probably just X" | "Probably" means you haven't checked. Check. |
| "I don't have time to investigate" | You don't have time NOT to. Ad-hoc fixes take 4-8x longer. |
| "This worked before, so it must be Y" | Correlation isn't causation. Bisect, don't guess. |

### Common Scenarios

**Test passes locally, fails in CI:** Environment diff — check paths, CWD, env vars, installed binaries.

**"It worked before":** `git bisect` to find breaking commit. Compare the change.

## Done when

- Root cause identified and stated in one sentence
- Hypothesis formed and tested — one variable at a time
- Fix addresses root cause, not symptoms
- Test reproducing the bug exists
- Full test suite passes after fix

## Principles

- Root cause first, always
- One variable at a time
- Fix is minimal and focused
- Evidence over intuition
