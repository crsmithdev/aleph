---
name: code-suggest
description: Forward-looking architectural improvement scout. Explores the codebase for friction (shallow modules, tight coupling, untested seams), proposes module-deepening refactors, classifies dependencies (in-process / local-substitutable / remote-owned / true-external), designs 3+ alternative interfaces in parallel via subagents, gives an opinionated recommendation, and optionally files an RFC GitHub issue. Suggestion-only — proposes the shape; application routes through code-review's structural-restructure fix shape. Distinct from code-review: review checks whether existing code obeys the rules and applies fixes to violations; suggest looks at whether the code's shape will hurt forward and proposes redesigns. Adapted from kennethkeim/skills/improve-codebase-architecture (Ousterhout's deep-modules framing). Triggers on /code-suggest, "improve the architecture", "improve architecture", "find refactoring opportunities", "refactoring opportunities", "what should I refactor", "where should I refactor", "deepen modules", "deepen this module", "make this more testable", "architectural review", "architectural debt", "architectural improvement", "tightly coupled modules", "tightly coupled", "shallow module", "shallow modules", "ports and adapters", "design alternatives", "module boundaries".
---

# code-suggest

Forward-looking architectural scout. Explores the codebase like an AI navigating it cold, names places where understanding is friction, proposes module-deepening refactors, designs alternatives in parallel, and produces an RFC.

**Distinct from code-review.** code-review asks "does the existing code obey the rules?" and applies fixes to violations. code-suggest asks "is this the shape we'd want forward?" and proposes redesigns. Slop, dead code, defensive overcoding, and the rest of `code/RULES.md` violations are code-review's job, not code-suggest's.

A **deep module** (Ousterhout, *A Philosophy of Software Design*) has a small interface hiding a large implementation. Deep modules are more testable, more AI-navigable, and let you test at the boundary instead of inside.

Suggestion-only. Proposes the shape and writes the issue; application of the chosen refactor routes through `code-review`'s structural-restructure fix shape.

## Process

### 1. Explore

Dispatch `Agent(subagent_type: "Explore")` to navigate the codebase organically. No rigid heuristic — note where the agent experiences friction:

- Understanding one concept requires bouncing between many small files
- A module's interface is nearly as complex as its implementation (shallow)
- Pure functions were extracted "for testability" but the real bugs live in how they're called
- Tightly coupled modules create integration risk at the seams
- Significant code paths are untested or hard to test

**The friction is the signal.** Don't enumerate every module; surface the ones that hurt.

Scope: `--module <path>` narrows; default is `src/` minus `src/ui/**` (architectural review of UI is a design concern, not a code-suggest concern).

### 2. Present candidates

Numbered list. For each:

- **Cluster** — which modules / concepts are involved (file paths)
- **Why they're coupled** — shared types, call patterns, co-ownership of a concept
- **Dependency category** — one of the four below
- **Test impact** — which existing tests would be replaced by boundary tests against the deepened module

Do **not** propose interfaces yet. Stop and ask: *"Which of these would you like to explore?"*

#### Dependency categories

| Category | Description | Strategy |
|---|---|---|
| **In-process** | Pure computation, in-memory state, no I/O | Merge the modules; test the result directly |
| **Local-substitutable** | Has a local test stand-in (PGLite, in-memory FS, etc.) | Deepen; test with the stand-in in the suite |
| **Remote but owned** | Your own services across a network boundary | Define a port; HTTP adapter for prod, in-memory adapter for tests |
| **True external** | Third-party services you don't control (Stripe, Twilio) | Mock at the boundary; inject the dependency |

### 3. Frame the problem space

Before designing interfaces, write a short user-facing explanation:

- Constraints any new interface would need to satisfy
- Dependencies it would need to rely on
- A rough illustrative code sketch — to ground the constraints, **not** a proposal

Post this, then immediately proceed to step 4 in parallel. The user reads while sub-agents work.

### 4. Design alternatives in parallel

Dispatch 3+ subagents (`Agent(subagent_type: "general-purpose")`) **in a single message** so they run concurrently. Each gets a brief (file paths, coupling details, dependency category, what's being hidden) plus a different design constraint:

| # | Constraint |
|---|---|
| 1 | Minimize the interface — 1–3 entry points maximum |
| 2 | Maximize flexibility — support many use cases and extension |
| 3 | Optimize for the most common caller — make the default trivial |
| 4 (when applicable) | Ports & adapters — for cross-boundary or remote-owned deps |

Each subagent returns:

1. Interface signature (types, methods, params)
2. Usage example
3. What complexity it hides
4. Dependency strategy (per the category table)
5. Trade-offs

### 5. Compare and recommend

Present designs sequentially. Compare them in prose. Give your own recommendation — which design is strongest, why, and whether a hybrid combines the best elements. **Be opinionated.** The user wants a strong read, not a menu.

### 6. File the RFC

Once the user picks (or accepts the recommendation), ask once: *"File this as a GitHub issue? (`gh issue create` — yes / no)"*. If yes, create it via `gh issue create` using the template below and share the URL. If no, output the rendered issue body to the conversation.

## Issue template

```markdown
## Problem

- Which modules are shallow and tightly coupled
- What integration risk exists in the seams
- Why this makes the codebase harder to navigate and maintain

## Proposed Interface

- Interface signature (types, methods, params)
- Usage example
- What complexity it hides internally

## Dependency Strategy

Which category applies and how dependencies are handled:
- **In-process**: merged directly
- **Local-substitutable**: tested with `<specific stand-in>`
- **Ports & adapters**: port definition, production adapter, test adapter
- **Mock**: mock boundary for external services

## Testing Strategy

- **New boundary tests to write**: behaviors to verify at the interface
- **Old tests to delete**: shallow-module tests that become redundant
- **Test environment needs**: local stand-ins, adapters, fixtures

## Implementation Recommendations

Durable guidance not coupled to current file paths:
- What the module should own
- What it should hide
- What it should expose
- How callers should migrate
```

## Testing principle: replace, don't layer

- Old unit tests on shallow modules are waste once boundary tests exist — delete them
- Boundary tests assert on observable outcomes through the public interface, not internal state
- Boundary tests survive internal refactors — they describe behavior, not implementation

## Guardrails

- **Suggestion-only.** No edits outside `gh issue create`. Application routes through `code-review`'s structural-restructure fix shape.
- **Friction over checklist.** Don't enumerate every shallow module — only the ones a real reader would trip on.
- **Step 2 stops.** Do not design interfaces before the user has picked a candidate.
- **Step 4 is parallel.** Send all subagent calls in a single message. Sequential is slower and produces correlated suggestions.
- **Opinionated step 5.** Don't dodge the recommendation.
- **Confirm before filing.** Ask once before `gh issue create`. Issue creation is visible to the team and hard to reverse.
- **Out of scope:** rules violations on existing code (use `code-review`), UI design (use `design-review`), docs (use `docs-review`), agent config (use `agent-review`), bug investigation (use `debug`).
