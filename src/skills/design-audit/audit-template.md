# Audit Output Template

Use this exact structure when presenting audit findings. No deviations.

---

```
DESIGN AUDIT RESULTS

Overall Assessment: [1-2 sentences on the current state of the design]

---

PHASE 1 — Critical
(Visual hierarchy, usability, responsiveness, or consistency issues that actively hurt UX)

- [Screen/Component]: [What's wrong] -> [What it should be] -> [Why this matters]
- [Screen/Component]: [What's wrong] -> [What it should be] -> [Why this matters]

Review: [Why these are highest priority]

---

PHASE 2 — Refinement
(Spacing, typography, color, alignment, iconography that elevate the experience)

- [Screen/Component]: [What's wrong] -> [What it should be] -> [Why this matters]
- [Screen/Component]: [What's wrong] -> [What it should be] -> [Why this matters]

Review: [Why this sequencing]

---

PHASE 3 — Polish
(Micro-interactions, transitions, empty/loading/error states, dark mode, subtle details)

- [Screen/Component]: [What's wrong] -> [What it should be] -> [Why this matters]
- [Screen/Component]: [What's wrong] -> [What it should be] -> [Why this matters]

Review: [Why these are Phase 3 and expected cumulative impact]

---

DESIGN SYSTEM UPDATES REQUIRED

- [New tokens, colors, spacing values, typography changes, or component additions needed]
- These must be approved before implementation begins

---

IMPLEMENTATION NOTES

- [Exact file, exact component, exact property, exact old value -> exact new value]
- Written so implementation can execute without design interpretation
- No ambiguity

BAD:  "Make the cards feel softer"
GOOD: "CardComponent border-radius: 8px -> 12px (token border-radius-lg)"

BAD:  "Improve the spacing"
GOOD: "DashboardHeader margin-bottom: 16px -> 24px (token spacing-lg)"

BAD:  "The button needs more contrast"
GOOD: "PrimaryButton background: #6B7280 -> #2563EB (token color-brand-primary).
       Contrast ratio with white text improves from 3.8:1 -> 8.6:1 (WCAG AAA)"
```

---

## Rules for This Template

1. Every finding follows: **what's wrong -> what it should be -> why it matters**
2. Implementation notes must reference design system tokens, not raw values
3. If a new token is needed, it goes in DESIGN SYSTEM UPDATES first
4. No vague language. No "feels" without a measurable change attached.
5. Phase assignment is strict:
   - Phase 1: Actively hurts usability or breaks consistency
   - Phase 2: Doesn't hurt, but clearly below professional standard
   - Phase 3: Already functional, but not yet premium
