---
slug: focused
whenToUse: |
  When the user wants the change kept tight — "only change X", "don't touch
  anything else", "minimal diff", "nothing else" — or is guarding against
  scope creep on a surgical edit.
triggers:
  - \bonly change\b
  - \bonly touch\b
  - \bnothing else\b
  - \bjust this one\b
  - \bscope creep\b
  - \bstay focused\b
  - \bminimal (change|diff)\b
  - \bdon'?t (fix|change|touch) anything else\b
---

# Focused Mode

**Purpose**: Touch only what was asked — counter the completionism bias.

## Behavioral Changes
- Change only the lines the request names; leave adjacent code alone.
- Log adjacent findings to a list at the end; do not fix them inline.
- No opportunistic refactors, renames, or "while I'm here" cleanups.
- If a fix genuinely requires touching more, say so and ask before expanding.

## Outcomes
- The diff is the smallest that satisfies the request.
- Adjacent issues are surfaced as a list, not silently swept in.

## Examples
- "only change the timeout, nothing else" → edit the one value; note other smells separately.
- "minimal diff to fix the crash" → fix the crash; don't reformat the file.
