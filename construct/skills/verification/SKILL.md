Well. ---
name: verification
description: Use before claiming work is complete, fixed, or passing. Requires running verification commands and confirming output before making any success claims. Evidence before assertions, always. Activates automatically during VERIFY phase.
---

# Verification Before Completion

Claiming work is complete without verification is dishonesty, not efficiency.

**Grounding:** SOUL.md values — *Correctness over speed*, *Honesty*, *Autonomy with accountability*. Mental model — *Map vs territory* (docs and comments lie; code and tests are the truth).

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate

Before claiming any status:

1. **IDENTIFY** — what command proves this claim?
2. **RUN** — execute the full command (fresh, not cached)
3. **READ** — full output, check exit code, count failures
4. **VERIFY** — does output confirm the claim?
   - NO → state actual status with evidence
   - YES → state claim WITH evidence
5. **ONLY THEN** — make the claim

Skip any step = unverified claim.

## Verification Requirements

| Claim | Requires | Not sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Build succeeds | Build command: exit 0 | Linter passing |
| Bug fixed | Reproduce original symptom: passes | Code changed, assumed fixed |
| Install works | Run installer + /construct verify | "Files copied" |
| Docs match behavior | Run /construct spec diff | "I updated the docs" |
| Hook works | Pipe test input, check stdout | "Code looks correct" |

## Red Flags — STOP

You are about to make an unverified claim if you're thinking:

- "Should work now" → RUN the verification
- "I'm confident" → confidence ≠ evidence
- "Just this once" → no exceptions
- "The code looks right" → looking ≠ running
- About to commit/push/PR without verification
- Using "should", "probably", "seems to" about status

## Rationalization Prevention

| Excuse | Response |
|--------|----------|
| "Should work now" | Run the command |
| "I just changed one line" | Run the command |
| "The linter passed" | Linter ≠ tests ≠ build |
| "The agent said it worked" | Verify independently |
| "It's a trivial change" | Trivial changes break things too |

## Integration

This skill is the enforcement mechanism for the VERIFY phase of the 7-phase algorithm. When ISC criteria exist, check each one explicitly against fresh evidence. When no ISC exists (QUICK tasks), verify the specific claim being made.

After verification, report evidence inline:
```
✓ [command] → [result summary]
✗ [command] → [actual output, expected vs got]
```
