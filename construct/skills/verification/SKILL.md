---
name: verification
description: Use before claiming work is complete, fixed, or passing. Requires running verification commands and confirming output. Evidence before assertions, always.
---

# Verification

Claiming work is complete without verification is dishonesty, not efficiency.

## When to Use

- Before claiming work is complete, fixed, or passing
- After any change that needs proof it works

## Process

### The Iron Law

**No completion claims without fresh verification evidence.** If you haven't run the verification command in this message, you cannot claim it passes.

### The Gate

1. **IDENTIFY** — what command proves this claim?
2. **RUN** — execute the full command (fresh, not cached)
3. **READ** — full output, check exit code, count failures
4. **VERIFY** — does output confirm the claim?
   - NO → state actual status with evidence
   - YES → state claim WITH evidence
5. **ONLY THEN** — make the claim

Skip any step = unverified claim.

### Verification Requirements

| Claim | Requires | Not sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Build succeeds | Build command: exit 0 | Linter passing |
| Bug fixed | Reproduce original symptom: passes | Code changed, assumed fixed |

### Red Flags — STOP

You are about to make an unverified claim if you're thinking:

- "Should work now" → run the command
- "I'm confident" → confidence ≠ evidence
- "I just changed one line" → run the command
- "The code looks right" → looking ≠ running
- "The linter passed" → linter ≠ tests ≠ build
- "The agent said it worked" → verify independently

## Done when

- Every claim backed by fresh command output in the same message
- Exit codes checked, failure counts at zero
- Evidence reported inline: `✓ [command] → [result]` or `✗ [command] → [actual vs expected]`

## Principles

- Evidence before assertions — no claim without fresh verification
- Run the actual command, not a proxy (linter ≠ tests ≠ build)
- When completion criteria exist, check each one explicitly against fresh evidence
