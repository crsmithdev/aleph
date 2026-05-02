---
name: design-conform
description: Apply a UI pattern from one file across peers — layout, component composition, state coverage, tokens. Use when the user points at a page or component and wants other UI surfaces to match — table formatting, page-header alignment, loading/empty/error states, typography, density, spacing rhythm. Triggers on phrases like "make these pages match", "align the layouts", "same loading state", "match the table headers", "make the components consistent", or "/design-conform".
---

# Design Conform

Take a UI reference (a page, component, or recently-polished layout), find peer surfaces that should look like it, and align them. Ad-hoc — no registry, no design system spec file. The reference *is* the spec.

## When to use

- User points at a polished page and asks to align peer pages.
- User notices visual drift between similar surfaces (tables, detail pages, headers, empty states).
- User finishes refining one screen and wants peer screens to match.
- User invokes `/design-conform`.

## When NOT to use

- Logic / behavior / data-flow drift — that's `code-conform`.
- Full UI audit with no specific reference — that's `design-audit`.
- Pure typography correctness (smart quotes, em dashes, character entities) — that's `design-type`.
- Single-page polish with no peers — just edit directly.

## Inputs

The user gives some combination of:

1. **Reference** (required) — a file path, component name, or description of recent work ("the way the new SettingsPage looks"). Always something concrete you can read and load in a browser.
2. **Scope** (optional) — a directory, glob, or list of files. Defaults to auto-detected peers.
3. **Notes** (optional) — what dimensions to focus on or ignore. Free-form trailing text.
4. **Mode flags** (optional) — `--report` for audit-only (no fixes), `--all` to include legacy pages (default: only files Claude is touching this session).

## Process

### 1. Resolve the reference

Read the reference file. If the user pointed at a section or recent edit, locate the exact lines. If the reference is ambiguous, ask before proceeding.

### 2. Identify what's distinctive

Extract the *pattern* — not the whole file. Five dimensions:

- **Layout & rhythm** — vertical spacing, container widths, alignment, density
- **Component composition** — which primitives are used (`<PageHeader>`, `<DataTable>`, `<Card>`); ad-hoc structures vs shared components
- **State coverage** — does the reference handle loading / empty / error / skeleton uniformly, and do peers?
- **Tokens** — color, type scale, radius, shadow; are peers using `text-text-muted` and `bg-bg-secondary` or hex codes?
- **Microcopy shape** — empty-state phrasing, error sentence shape, button verb tense

If the user gave notes ("only the header"), narrow to that. Otherwise default to *everything that looks like an intentional pattern* — skip incidental differences (specific text content, page-specific data shapes).

For the full taxonomy with concrete sub-bullets, see `references/dimensions.md`.

### 3. Find peers

Auto-detect candidates by, in order:

1. Filename pattern (`*Page.tsx`, `*Table.tsx`, `*DetailPage.tsx`)
2. Directory siblings of the reference
3. Files that import the same layout primitive (e.g. all `<PageHeader>` consumers, all `<DataTable>` consumers)
4. Components rendered by the same parent route
5. Files Claude has touched recently in this session (when in default diff-only mode)

If the user gave an explicit scope, use that as a filter on the candidates.

**Always present the peer list before doing any work.** "Found 7 peers: A, B, C, D, E, F, G. Trim or proceed?" Let the user remove false positives.

### 4. Compare and report

For each peer, diff against the reference along the chosen dimensions. Rank by severity:

- **Major** — pattern is missing entirely (no `<PageHeader>`, missing empty state, hand-rolled `<h1>` instead of `<PageTitle>`)
- **Minor** — pattern is present but degraded (font size off, padding inconsistent, header missing breadcrumb slot)
- **Stylistic** — pattern matches but small surface differences (icon size, hover color)

### 5. Reference-as-outlier check

Before proposing fixes, sanity-check: if the reference differs from a *majority* of its peers, surface this:

> "Note: 5 of 7 peers don't follow the reference's layout. Is the reference the new canonical, or did I pick the wrong anchor?"

User can confirm "reference wins" (proceed) or flip the anchor.

### 6. Apply fixes (after approval)

For each approved peer:

- Read the peer file
- Compute the minimal `Edit` to bring it in line with the reference *for the chosen dimensions*
- Use shared primitives over hand-rolled markup (replace inline `<h1 class="...">` with `<PageHeader>`)
- Preserve domain content, page-specific data shapes, and incidental differences
- **Do not** import unused things; **do not** add visual elements (icons, badges) the peer didn't already have

Verify with `bun run ui:smoke` (required — per project rule), then eyeball the affected route in the browser. See `references/verification.md` for the exact workflow.

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
/design-conform src/ui/web/src/components/data/DataTable.tsx
  → peers = consumers of DataTable; align column-typing patterns

/design-conform src/ui/web/src/components/layout/PageHeader.tsx
  → peers = consumers of PageHeader; align title font and breadcrumb usage

/design-conform src/ui/web/src/pages/system/observability/EvalsPage.tsx — table only
  → narrow to the table; ignore page-level chrome

/design-conform the loading state across all detail pages
  → no fixed anchor; skill picks the cleanest, asks for confirmation

/design-conform --report
  → audit only, no fixes
```

For three fully worked cases (with reference, peers, diff, and verification), see `examples/`:

- `examples/table-consistency.md` — column typing, formatting, sortability across DataTable consumers
- `examples/page-header-alignment.md` — title font/size/breadcrumb consistency across page headers
- `examples/typography-floor.md` — minimum font size and consistent role mapping across the UI

## Guardrails

- **Never propose fixes without showing the peer list first.** The user must be able to trim false positives before any edits.
- **Never rewrite a file wholesale** unless the user explicitly approves it. Minimal edits.
- **Never enforce a dimension the user didn't ask for** when notes are present.
- **Never trigger on legacy files in default mode.** Diff-only by default.
- **Surface intentional divergence.** If a peer has `// conform:exempt` or an obvious comment indicating intentional difference, skip it and note in the report.
- **One reference, one pass.** Don't try to enforce multiple unrelated patterns in a single invocation — ask the user to run again with a different reference.
- **`bun run ui:smoke` is non-negotiable.** Every UI conform pass must run it before claiming done. Build alone is not sufficient (per `feedback_ui_done_requires_page_load`).

## Output format

```
Reference: <path>[:section]
Pattern dimensions: <list, derived from reference + notes>
Peers considered: <count>
Drift: Major <n> / Minor <n> / Aligned <n>

[detailed list]

Proposed edits: <count> across <count> files
[show diffs, gate on approval]

After fix: ui:smoke result + eyeballed routes
```
