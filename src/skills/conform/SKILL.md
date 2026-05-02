---
name: conform
description: Apply a pattern from one file across similar files in the codebase. Use when the user points at a reference and wants peers to match — page layouts, component structures, route handlers, error handling, table formatting, or any cross-file consistency. Triggers on phrases like "make the others like X", "apply this pattern to", "align with", "match the way I did", "fix drift", "standardize", or "/conform".
---

# Conform

Take a reference (a file, a section, or a recent edit), find peer files in the codebase that should look like it, and align them. Ad-hoc — no registry, no config. The reference *is* the spec.

## When to use

- User points at a file and asks to apply its pattern elsewhere.
- User notices drift between similar things (pages, tables, routes, providers).
- User finishes refactoring one instance and wants the same shape on its peers.
- User invokes `/conform`.

## When NOT to use

- Visual polish (spacing, color, typography) — that's `design-audit` / `design-type`.
- General code quality / slop removal — that's `code-simplify`.
- Architecture review with no specific reference — that's `code-architect`.
- Single-file refactors with no peers — just edit directly.

## Inputs

The user gives some combination of:

1. **Reference** (required) — a file path, a file:section, a component name, or a description of recent work ("the way I just refactored similarity.ts"). Always something concrete you can read.
2. **Scope** (optional) — a directory, glob, or list of files. Defaults to auto-detected peers.
3. **Notes** (optional) — what dimensions to focus on or ignore. Free-form trailing text.
4. **Mode flags** (optional) — `--report` for audit-only (no fixes), `--all` to include legacy files (default: only files Claude is touching this session).

## Process

### 1. Resolve the reference

Read the reference file. If the user pointed at a section or recent edit, locate the exact lines. If the reference is ambiguous, ask before proceeding.

### 2. Identify what's distinctive

Extract the *pattern* — not the whole file:

- Structural: file/component shape, section ordering, exports
- Compositional: which helpers/hooks/wrappers are used
- Behavioral: error handling, loading state, validation, response shape
- Surface: imports, prop types, naming conventions

If the user gave notes ("only the header"), narrow to that. Otherwise default to *everything that looks like an intentional pattern* — skip incidental differences (variable names, comments, business logic specific to the file's domain).

### 3. Find peers

Auto-detect candidates by, in order:

1. Filename pattern (`*DetailPage.tsx`, `*Table.tsx`, `routes/*.ts`)
2. Directory siblings of the reference
3. Files that import the same key dependencies
4. Files Claude has touched recently in this session (when in default diff-only mode)

If the user gave an explicit scope, use that as a filter on the candidates.

**Always present the peer list before doing any work.** "Found 7 peers: A, B, C, D, E, F, G. Trim or proceed?" Let the user remove false positives.

### 4. Compare and report

For each peer, diff against the reference along the chosen dimensions. Rank by severity:

- **Major** — pattern is missing entirely (no header, wrong wrapper, different error handling)
- **Minor** — pattern is present but degraded (inconsistent prop names, slightly different structure)
- **Stylistic** — pattern matches but small surface differences

Report format:

```
Reference: src/ui/web/src/pages/research/ResearchQueryDetailPage.tsx
Pattern: page header + breadcrumb + tabs structure
Peers found: 7

Drift detected:
  Major (2):
    - ResearchQueryListPage.tsx — missing PageHeader, uses raw <h1>
    - LifeSummaryPage.tsx — breadcrumb wired differently, no tab container
  Minor (1):
    - SignalsPage.tsx — PageHeader present but title prop named differently
  Aligned (4): [list]

Proceed with fixes? [all / pick / report-only]
```

### 5. Reference-as-outlier check

Before proposing fixes, sanity-check: if the reference differs from a *majority* of its peers, surface this:

> "Note: 5 of 7 peers don't follow the reference's pattern. Is the reference the new canonical, or did I pick the wrong anchor?"

User can confirm "reference wins" (proceed) or flip the anchor.

### 6. Apply fixes (after approval)

For each approved peer:

- Read the peer file
- Compute the minimal edit to bring it in line with the reference *for the chosen dimensions*
- Use the `Edit` tool — never rewrite wholesale unless the peer is severely degraded
- Preserve domain logic, business-specific behavior, and incidental differences
- Do **not** import unused things; do **not** add error handling for impossible cases
- Verify with the appropriate gate (`bun test.ts`, `bun run build`, `bun run ui:smoke`) per project rules

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
/conform src/ui/web/src/pages/research/ResearchQueryDetailPage.tsx
  → auto-detect peer detail pages, compare whole-file structure

/conform ResearchQueryDetailPage.tsx — header + breadcrumbs only
  → narrow comparison to those dimensions

/conform src/ui/web/src/components/ResearchTable.tsx within src/ui/web/src/components/
  → reference + explicit scope glob

/conform src/ui/api/src/app.ts:research route handler — error wrapping, validation
  → file:section reference, dimensions in notes

/conform the loading state across all detail pages — pick the cleanest as reference
  → no fixed anchor; skill picks, asks for confirmation

/conform the way I just refactored similarity.ts — apply to engine.ts and openrouter.ts
  → reference resolved from recent diffs, explicit peer list

/conform ResearchQueryDetailPage.tsx --report
  → audit only, no fixes

/conform openrouter.ts as the new pattern — older providers are stale, update them
  → reference is new; suppresses outlier warning

/conform
  → no args: look at most recent diff, offer to align peers
```

## Guardrails

- **Never propose fixes without showing the peer list first.** The user must be able to trim false positives before any edits.
- **Never rewrite a file wholesale** unless the user explicitly approves it. Minimal edits.
- **Never enforce a dimension the user didn't ask for** when notes are present.
- **Never trigger on legacy files in default mode.** Diff-only by default.
- **Surface intentional divergence.** If a peer has `// conform:exempt` or an obvious comment indicating intentional difference, skip it and note in the report.
- **One reference, one pass.** Don't try to enforce multiple unrelated patterns in a single invocation — ask the user to run again with a different reference.

## Output format

```
Reference: <path>[:section]
Pattern dimensions: <list, derived from reference + notes>
Peers considered: <count>
Drift: Major <n> / Minor <n> / Aligned <n>

[detailed list]

Proposed edits: <count> across <count> files
[show diffs, gate on approval]

After fix: [verification command run + result]
```
