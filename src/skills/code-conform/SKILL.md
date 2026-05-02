---
name: code-conform
description: Apply a code pattern from one file (handler, provider, hook, route, schema, helper) across peers — pattern propagation OR consolidation onto a single source of truth. Use when the user points at a reference and wants peer code to match, or notices the same problem solved in multiple places. Triggers on phrases like "align the routes", "match this handler", "make the providers consistent", "fix drift in the schemas", "consolidate the duplicate helpers", "single source of truth", "deduplicate", or "/code-conform".
---

# Code Conform

Take a code reference (a file, a section, or a recent edit), find peer files in the codebase that should look like it, and align them. Two adjacent shapes — both fit the same spine:

1. **Pattern propagation** — same shape across peer files (route handlers, providers, hooks).
2. **Single-source-of-truth consolidation** — same problem solved in multiple places; pick the canonical helper, route call sites through it, delete the duplicates.

Ad-hoc — no registry, no config. The reference *is* the spec.

## When to use

- User points at a file/helper and asks to apply its pattern elsewhere.
- User notices behavior or shape drift between similar things (handlers, providers, schemas).
- User finishes refactoring one instance and wants the same shape on its peers.
- User notices the same problem solved inline in multiple places and wants one helper to win.
- User invokes `/code-conform`.

## When NOT to use

- Visual / layout / typography drift — that's `design-conform`.
- General code quality / slop removal — that's `code-simplify`.
- Architecture review with no specific reference — that's `code-architect`.
- Single-file refactors with no peers — just edit directly.

## Inputs

The user gives some combination of:

1. **Reference** (required) — a file path, a `file:section`, a function/helper name, or a description of recent work ("the way I just refactored similarity.ts"). Always something concrete you can read.
2. **Scope** (optional) — a directory, glob, or list of files. Defaults to auto-detected peers.
3. **Notes** (optional) — what dimensions to focus on or ignore. Free-form trailing text.
4. **Mode flags** (optional) — `--report` for audit-only (no fixes), `--all` to include legacy files (default: only files Claude is touching this session).

## Process

### 1. Resolve the reference

Read the reference file. If the user pointed at a section or recent edit, locate the exact lines. If the reference is ambiguous, ask before proceeding.

### 2. Identify what's distinctive

Extract the *pattern* — not the whole file. Five dimensions:

- **Structural** — file/section ordering, exports, function signatures
- **Compositional** — which helpers/wrappers/classes are used
- **Behavioral** — error handling, validation, response shape, retries, fallbacks
- **Surface** — imports, type names, naming conventions
- **Duplication of behavior across modules** — first-class axis. If the reference is "the helper that should exist," peers are sites re-solving the same problem inline. The fix shape is consolidation, not propagation.

If the user gave notes ("only error wrapping"), narrow to that. Otherwise default to *everything that looks like an intentional pattern* — skip incidental differences (variable names, business logic specific to the file's domain).

For the full taxonomy with concrete sub-bullets, see `references/dimensions.md`.

### 3. Find peers

Auto-detect candidates by, in order:

1. Filename pattern (`*.handler.ts`, `routes/*.ts`, `providers/*.ts`)
2. Directory siblings of the reference
3. Files that import the same key dependencies
4. Files Claude has touched recently in this session (when in default diff-only mode)

If the user gave an explicit scope, use that as a filter on the candidates.

For the duplication-axis case, also grep for the inline shape (e.g. `grep -rn "split('__')" src/` if the reference helper centralizes that parse). Sites matching the inline shape are peers even if they don't share filename or directory.

**Always present the peer list before doing any work.** "Found 7 peers: A, B, C, D, E, F, G. Trim or proceed?" Let the user remove false positives.

### 4. Compare and report

For each peer, diff against the reference along the chosen dimensions. Rank by severity:

- **Major** — pattern is missing entirely (no error wrapping, wrong response shape, inline reimplementation of a centralized helper)
- **Minor** — pattern is present but degraded (inconsistent prop names, slightly different validation order)
- **Stylistic** — pattern matches but small surface differences

### 5. Reference-as-outlier check

Before proposing fixes, sanity-check: if the reference differs from a *majority* of its peers, surface this:

> "Note: 5 of 7 peers don't follow the reference's pattern. Is the reference the new canonical, or did I pick the wrong anchor?"

User can confirm "reference wins" (proceed) or flip the anchor.

### 6. Apply fixes (after approval)

Two paths:

- **(a) Propagate** — minimal `Edit` on each peer. Compute the smallest change to bring it in line with the reference *for the chosen dimensions*. Never rewrite wholesale unless the peer is severely degraded. Preserve domain logic, business-specific behavior, and incidental differences.
- **(b) Consolidate** — rewrite peers to call the canonical helper. Remove their now-dead local copies. If the canonical helper needs a small surface tweak to absorb peer use cases, edit it once, then route everyone through it. **Do not** import unused things; **do not** add error handling for impossible cases.

Verify with the appropriate gate: `bun test.ts` for backend, `bun run build` (in `src/ui`) for typed frontend, optional ast-grep structural diff. See `references/verification.md` for exact commands.

### 7. Summarize

One paragraph: which peers were aligned, which were skipped and why, and what (if anything) the user should still review by eye.

## Default scope: diff-only

By default, only consider peers that:

- Were edited in the current session, OR
- Are explicitly named in the user's invocation, OR
- Are auto-detected and confirmed in step 3

This prevents drowning the user in legacy drift. Use `--all` to include every peer in the codebase.

## Worked invocations

```
/code-conform src/research/src/providers/websearch.ts:fetchSearchResults
  → align tavilySearch / braveSearch / duckduckgoSearch error-handling shape

/code-conform src/ui/web/src/utils/format.ts:fmtToolName
  → consolidate inline `name.slice(5).split('__')` callers onto the centralized helper

/code-conform src/goals/src/services/todos.ts:createTodo — eventBus emissions only
  → behavioral conformance: every state change emits a fully-populated AppEvent

/code-conform src/research/src/providers/openrouter.ts as the new pattern
  → reference is new; suppresses outlier warning

/code-conform --report
  → audit only, no fixes
```

For three fully worked cases (with reference, peers, diff, and verification), see `examples/`:

- `examples/identifier-sanitization.md` — single-source-of-truth consolidation
- `examples/event-log-completeness.md` — behavioral conformance across mutation paths
- `examples/provider-conformance.md` — error-handling shape across peer providers

## Guardrails

- **Never propose fixes without showing the peer list first.** The user must be able to trim false positives before any edits.
- **Never rewrite a file wholesale** unless the user explicitly approves it. Minimal edits.
- **Never enforce a dimension the user didn't ask for** when notes are present.
- **Never trigger on legacy files in default mode.** Diff-only by default.
- **Surface intentional divergence.** If a peer has `// conform:exempt` or an obvious comment indicating intentional difference, skip it and note in the report.
- **One reference, one pass.** Don't try to enforce multiple unrelated patterns in a single invocation — ask the user to run again with a different reference.
- **Consolidation removes dead code.** When you route a peer through a canonical helper, the peer's now-unused inline implementation, helper, or import must go (Commandment 7: remove completely).

## Output format

```
Reference: <path>[:section]
Pattern dimensions: <list, derived from reference + notes>
Shape: propagation | consolidation
Peers considered: <count>
Drift: Major <n> / Minor <n> / Aligned <n>

[detailed list]

Proposed edits: <count> across <count> files
[show diffs, gate on approval]

After fix: [verification command run + result]
```
