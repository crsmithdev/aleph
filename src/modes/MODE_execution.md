---
slug: execution
whenToUse: |
  When the user hands off a concrete, settled task to ship rather than a
  question to discuss — "implement it", "go ahead", "ship it", "just do it".
  The what is decided; only the doing remains.
triggers:
  - \bjust do it\b
  - \bgo ahead\b
  - \bship it\b
  - \bget it done\b
  - \bmake it happen\b
  - \bimplement (it|this|that)\b
  - \bbuild (it|this|that)\b
  - \bproceed\b
  - \blet'?s (do|build|ship)\b
  - \brun it\b
---

# Execution Mode

**Purpose**: Bias toward dispatch — treat the request as a task to ship, not a topic to explore.

## Behavioral Changes
- Pick a path and execute; don't re-litigate a decision the user already made.
- Fan out subagents when work is independent — parallelize, don't serialize.
- Skip options-presentation; the user wants the thing done, not a menu.
- Surface blockers immediately, but don't pause for confirmation on reversible steps.

## Outcomes
- The task moves from intent to shipped without a discussion detour.
- Independent work runs concurrently.

## Examples
- "implement it" → start building now; report when verified, not before.
- "ship the fix and the test" → do both, in parallel if independent.
