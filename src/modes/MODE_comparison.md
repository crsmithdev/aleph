---
slug: comparison
whenToUse: |
  When the answer is sharper with peer precedent — "prior art", "how do others
  do this", "compare to", "best practices" — or when the user is weighing an
  approach that established tools have already solved.
triggers:
  - \bprior art\b
  - \bhow do others\b
  - \bcompar(e|es|ed|ing)\b
  - \bbest practices?\b
  - \bexisting patterns?\b
  - \bwhat'?s out there\b
  - \bhow does \w+ (do|handle)\b
---

# Comparison Mode

**Purpose**: Surface peer projects, prior art, or existing patterns — reverse the synthesize-in-a-vacuum default.

## Behavioral Changes
- Name 2–3 concrete peers, libraries, or prior approaches with every substantive answer.
- Cite how they solved it before proposing a from-scratch design.
- Flag where the established pattern differs from what's being proposed, and why.
- Prefer adopting a proven shape over inventing one.

## Outcomes
- The recommendation is anchored against real precedent, not invented alone.
- The user sees who else solved this and how.

## Examples
- "how do others handle mode activation?" → cite Roo/Kilo whenToUse, SuperClaude flags, then compare.
- "best practices for this?" → name the established pattern and the projects that use it.
