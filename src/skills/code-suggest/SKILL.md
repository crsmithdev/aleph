---
name: code-suggest
description: Proactive code-improvement scout. Two flows. (a) Tactical cleanup — surface AI-generated slop in the current diff (defensive try/catch, restating comments, backwards-compat shims with no consumers, scope-creep changes to unchanged code, impossible-case throws, `any` casts) plus style refinements (function over arrow at top level, explicit return types, no nested ternaries), present findings, apply approved removals, run the test suite. (b) Architectural — explore the codebase for friction (shallow modules, tight coupling, untested seams), classify dependencies (in-process / local-substitutable / remote-owned / true-external), design 3+ alternative interfaces in parallel, recommend one, optionally file as an RFC GitHub issue. Adapted from kennethkeim/skills/improve-codebase-architecture (Ousterhout's deep-modules framing). Triggers on /code-suggest, "deslop", "remove slop", "simplify this", "simplify before commit", "simplify code", "clean up code", "clean this up", "remove boilerplate", "too much boilerplate", "over-engineered", "unnecessary comments", "improve the architecture", "find refactoring opportunities", "what should I refactor", "deepen modules", "make this more testable", "architectural review", "architectural debt", "tightly coupled modules", "shallow module", "ports and adapters", "design alternatives", "module boundaries".
---

# code-suggest

Proactive improvement scout — two flows, picked by the trigger:

| Flow | When | Output |
|---|---|---|
| **Tactical cleanup** | "deslop", "simplify", "clean up", "remove boilerplate" | Scan the current diff for slop, present findings, apply approved removals, gate |
| **Architectural** | "improve architecture", "deepen modules", "ports and adapters" | Explore the codebase, present candidates, design alternatives in parallel, file an RFC |

If the trigger is ambiguous (bare `/code-suggest`), ask which flow.

---

# Flow A: tactical cleanup (slop + simplification)

For the current diff. Removes AI-generated cruft and applies the style refinements that ride along.

## Process

### 1. Scope

```bash
git diff --name-only $(git merge-base HEAD main)..HEAD -- 'src/**/*.ts' '*.ts'
```

If empty on clean main, fall back to `--since HEAD~10`; if still empty, exit `scope empty — pass --module <path> or --all`.

### 2. Scan for slop patterns

Walk the diff. Flag each occurrence with `file:line — pattern — rule cite`:

| Pattern | Rule | Detect |
|---|---|---|
| **Defensive code** | `code/RULES.md#B.1` | try/catch with no rethrow / log / branching — the catch swallows the error |
| **Restating comments** | `code/RULES.md#B.2` | `//` comment whose tokens ≥60% overlap with the next non-blank line's identifiers |
| **Backwards-compat shims** | `code/RULES.md#B.3` | exports / wrappers / `// removed`-style comments / renamed `_vars` with zero consumers (grep first to confirm) |
| **Scope creep** | `code/RULES.md#B.4` | cosmetic edits to code the user didn't touch (added docstrings, type annotations, refactors on unchanged lines) |
| **Impossible-case throws** | `code/RULES.md#B.5` | `throw` for a case that can't be reached given the inputs |
| **`any` casts** | `code/RULES.md#B.6` | `as any` introduced to bypass a type issue rather than fixing the type |

For each candidate, re-read the cited lines to confirm. Drop false positives — when in doubt, don't flag.

### 3. Scan for style refinements that ride along

Apply only if the diff already touches them:

- Prefer `function` keyword over arrow at top-level declarations
- Explicit return type annotations on exported functions
- No nested ternaries — convert to `switch` or `if/else`
- Three similar lines beat a premature abstraction
- ES modules with proper import sorting and extensions

Don't reformat untouched code — that's scope creep itself.

### 4. Report

Group by pattern. One line per finding: `path:line — pattern — what's there now. Remove or replace with: ...`.

### 5. STOP. Ask

Three shapes:
- **apply all** — every approved removal in one pass
- **pick** — go through each finding individually
- **discard** — surface as audit-only, no edits

For backwards-compat shim removals where the consumer-count check is uncertain, force per-finding approval.

### 6. Apply

In atomic groups, one file at a time. **Hard rules:**

- If a `catch` was suppressing a real error path, surface that as a new finding rather than silently removing — the catch goes, but the error path needs handling
- Removed code goes completely. No `// removed` markers, no orphaned imports, no commented-out blocks "for reference"
- No scope creep — if a fix surfaces an adjacent issue, log it as a new finding for the next pass
- Never rewrite a file wholesale to "clean it up" — only edit lines named by findings

### 7. Verify

Run `bun test.ts`. On failure: identify the broken fix, revert it, surface as a new finding. **Never silence a failing test to make the gate pass.**

Re-run `git diff $(git merge-base HEAD main)..HEAD` and confirm only slop was removed — no functional changes.

### 8. Closing

```
Applied N findings. Touched M files. Gate green. Skipped: <list with reasons>.
```

---

# Flow B: architectural improvement

Explore the codebase like an AI navigating it cold, name places where understanding is friction, propose module-deepening refactors, design alternatives, and produce an RFC.

A **deep module** (Ousterhout, *A Philosophy of Software Design*) has a small interface hiding a large implementation. Deep modules are more testable, more AI-navigable, and let you test at the boundary instead of inside.

This flow is suggestion-only. It proposes refactors and writes the issue. For applying approved refactors, follow up with `code-review` (the structural-restructure fix shape).

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

---

## Guardrails (both flows)

- **Cleanup is mutating but minimal.** Edit only what findings name. Never wholesale-rewrite.
- **Architectural is suggestion-only.** No edits outside `gh issue create`. Application routes through `code-review`'s structural-restructure shape.
- **Friction over checklist (Flow B).** Don't enumerate every shallow module — only the ones a real reader would trip on.
- **Stop before edits.** Flow A step 5 and Flow B step 2 are hard stops; no edits before approval.
- **Flow B step 4 is parallel.** Send all subagent calls in a single message. Sequential is slower and produces correlated suggestions.
- **Opinionated step 5 (Flow B).** Don't dodge the recommendation.
- **Confirm before filing.** Ask once before `gh issue create`. Issue creation is visible to the team and hard to reverse.
- **Out of scope:** UI design (use `design-review`), docs (use `docs-review`), agent config (use `agent-review`), bug investigation (use `debug`), rules-based audit fixes (use `code-review`).
