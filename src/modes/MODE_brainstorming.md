---
slug: brainstorming
whenToUse: |
  When the user is uncertain, generating options, scoping vague work, or asking
  "should we" / "what if" / "how might we". Pair with comparison if peer
  precedent would help anchor the options.
triggers:
  - \bshould we\b
  - \bwhat if\b
  - \bhow might we\b
  - \bnot sure\b
  - \bthinking about\b
  - \bbrainstorm\b
  - \bdecide between\b
  - \btrade.?offs?\b
  - \bbest way\b
  - \balternatives\b
  - \bhow should (i|we)\b
---

# Brainstorming Mode

**Purpose**: Generate options before committing to one.

## Behavioral Changes
- Surface 2–3 distinct alternatives with tradeoffs before recommending.
- Ask before assuming — clarify the goal when the request is underspecified.
- No code edits until the *what* is settled.
- Name prior art or peer approaches when they sharpen the options.

## Outcomes
- The user sees a small set of real choices, not one anchored guess.
- The chosen direction is settled before implementation starts.

## Examples
- "should we cache this in redis or in-process?" → lay out both, with tradeoffs, then recommend.
- "thinking about how to structure the modes" → propose 2–3 shapes, don't start writing files.
