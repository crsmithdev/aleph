---
name: design-fix
description: >
  Apply fixes for peer-drift findings in UI surfaces — propagate a layout, component
  composition, state coverage, token usage, or microcopy pattern from one reference
  file to peer files. Takes SARIF findings (with `tag: peer-drift` from design-audit)
  as input or runs an inline audit pass first. Verifies with `gate("design")`
  (resolves to `bun run ui:smoke`). Triggers on "make the pages match",
  "align the layouts", "same loading state", "match the table headers",
  "make the components consistent", "apply this design pattern", or `/design-fix`.
verb: fix
domain: design
modes: [fix]
---

# Design Fix

Applies edits derived from `peer-drift` findings on UI surfaces. Each finding describes the canonical reference (`relatedLocations`) and the drifted peer (`locations`); this skill executes the propagation minimally and verifies with `gate("design")`.

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix.

## When to use

- After `design-audit` produced `tag: peer-drift` findings and the user approved them.
- User invokes `/design-fix` against a saved SARIF report, or `/fix design` via the omnibus.
- User invokes `/design-fix <reference>` directly — runs an inline audit pass against that reference (no SARIF input), then asks for approval before applying.

## When NOT to use

- Logic/data drift — that's `code-conform`.
- Full UI audit with no specific reference — that's `design-audit`.
- Pure typography correctness (smart quotes, em dashes, character entities) — `design-audit` flags these as `tag: typography` findings citing `design/RULES.md#B`; this skill only propagates *patterns*, not individual character substitutions.
- Single-page polish with no peers — just edit directly.
- Net-new features (this skill propagates *patterns*, not roadmap items).

## Inputs

1. **Findings** (preferred path, omnibus dispatch) — SARIF v2.1.0 with `tag: peer-drift`. Each finding's `locations[0]` is the drifted peer; `relatedLocations[0]` is the canonical reference.
2. **Reference** (required for direct invocation) — file path, component name, or description of recent work. Always something concrete you can read and load in a browser.
3. **Scope** — inherited from the findings; for direct invocation defaults to auto-detected peers in the current session's diff.
4. **Notes** (optional) — which dimensions to focus on or ignore.
5. **Mode flags** (optional) — `--report` for audit-only (no fixes; emits SARIF and stops), `--all` to include legacy pages (default: only files in the current session's diff).

## Process

### 1. Resolve findings

If findings provided (omnibus path), parse the SARIF and group by reference (multiple peers may point at the same canonical surface). Otherwise run an inline audit pass:

1. Read the reference file. If the user pointed at a section or recent edit, locate the exact lines. If the reference is ambiguous, ask before proceeding.
2. Identify what's distinctive — see step 2.
3. Find peers — see step 3.
4. Compare and emit `peer-drift` findings — see step 4.
5. Gate on user approval before applying.

### 2. Identify what's distinctive

Extract the *pattern* — not the whole file. Five dimensions:

- **Layout & rhythm** — vertical spacing, container widths, alignment, density
- **Component composition** — which primitives are used (`<PageHeader>`, `<DataTable>`, `<Card>`); ad-hoc structures vs shared components
- **State coverage** — does the reference handle loading / empty / error / skeleton uniformly, and do peers?
- **Tokens** — color, type scale, radius, shadow; are peers using `text-text-muted` and `bg-bg-secondary` or hex codes?
- **Microcopy shape** — empty-state phrasing, error sentence shape, button verb tense

If the user gave notes ("only the header"), narrow to that. Otherwise default to *everything that looks like an intentional pattern* — skip incidental differences (specific text content, page-specific data shapes).

For the full taxonomy, see `references/dimensions.md`.

### 3. Find peers

Auto-detect candidates by, in order:

1. Filename pattern (`*Page.tsx`, `*Table.tsx`, `*DetailPage.tsx`)
2. Directory siblings of the reference
3. Files that import the same layout primitive (e.g. all `<PageHeader>` consumers, all `<DataTable>` consumers)
4. Components rendered by the same parent route
5. Files Claude has touched recently in this session (when in default diff-only mode)

If the user gave an explicit scope, use that as a filter on the candidates.

**Always present the peer list before doing any work.** "Found 7 peers: A, B, C, D, E, F, G. Trim or proceed?" Let the user remove false positives.

### 4. Plan the edits

For each peer + dimension, compute the minimal `Edit` to bring it in line with the reference. Group edits by file so the patch lands atomically per file.

Rank severity:

- **Major** — pattern is missing entirely (no `<PageHeader>`, missing empty state, hand-rolled `<h1>` instead of `<PageTitle>`)
- **Minor** — pattern is present but degraded (font size off, padding inconsistent, header missing breadcrumb slot)
- **Stylistic** — pattern matches but small surface differences (icon size, hover color)

**Hard rules:**

- **Never rewrite a file wholesale** unless the user explicitly authorizes it and the finding's `properties.fix` says "rewrite".
- **Never enforce a dimension the user didn't ask for** when notes are present.
- **Never trigger on legacy files in default mode.** Diff-only by default.
- **No scope creep.** If a fix surfaces an adjacent issue, log it as a new finding for the next audit — don't fix it in this pass.
- **Removed code goes completely.** Per Commandment 7: no `// removed` markers, no orphaned imports.

### 5. Reference-as-outlier check

Before proposing fixes, sanity-check: if the reference differs from a *majority* of its peers, surface this:

> "Note: 5 of 7 peers don't follow the reference's layout. Is the reference the new canonical, or did I pick the wrong anchor?"

User can confirm "reference wins" (proceed) or flip the anchor.

### 6. Show the plan

Output the planned edits as a unified diff or per-file edit list. For omnibus-dispatched runs with prior approval, proceed directly to step 7. For direct invocation, stop and wait for the user.

### 7. Apply edits

- Read each peer file.
- Compute the minimal `Edit` to bring it in line with the reference *for the chosen dimensions*.
- Use shared primitives over hand-rolled markup (replace inline `<h1 class="...">` with `<PageHeader>`).
- Preserve domain content, page-specific data shapes, and incidental differences.
- **Do not** import unused things; **do not** add visual elements (icons, badges) the peer didn't already have.

### 8. Verify

Run `gate("design")` from `VERIFICATION.md`. For Construct that resolves to `bun run ui:smoke` (loads every route in a real browser; asserts no render errors or 5xx). The skill MUST NOT claim done until the gate is green and the affected routes have been eyeballed.

`bun run build` alone is not sufficient — per `feedback_ui_done_requires_page_load`, build pass ≠ feature works. For any rendering bug, drive a real browser and measure the element.

For changes that touch shared types or API contracts, also run `gate("code")` (resolves to `bun test.ts`).

If `gate("design")` fails:

- Identify which peer change broke the render.
- Either revert that change and surface a new finding, OR adjust the fix and re-run the gate.
- Never silence a failing assertion to make the gate pass.

See `references/verification.md` for the full verification workflow.

### 9. Summarize

One paragraph: which peers were aligned, which were skipped and why, and what (if anything) the user should still review by eye.

## Default scope: diff-only

By default, only consider peers that:

- Were edited in the current session, OR
- Are explicitly named in the user's invocation, OR
- Are auto-detected and confirmed in step 3

This prevents drowning the user in legacy drift. Use `--all` to include every peer in the codebase.

## Worked invocations

```
/design-fix src/ui/web/src/components/data/DataTable.tsx
  → peers = consumers of DataTable; align column-typing patterns

/design-fix src/ui/web/src/components/layout/PageHeader.tsx
  → peers = consumers of PageHeader; align title font and breadcrumb usage

/design-fix src/ui/web/src/pages/system/observability/EvalsPage.tsx — table only
  → narrow to the table; ignore page-level chrome

/design-fix the loading state across all detail pages
  → no fixed anchor; skill picks the cleanest, asks for confirmation

/design-fix --report
  → audit only, no fixes; emits SARIF with tag: peer-drift
```

For three fully worked cases, see `examples/`:

- `examples/table-consistency.md`
- `examples/page-header-alignment.md`
- `examples/typography-floor.md`

## Output

```
[plan]
Reference: <path>[:section]
Pattern dimensions: <list, derived from reference + notes>
Peers considered: <count>
Drift: Major <n> / Minor <n> / Aligned <n>

... edit list ...
[/plan]

[applying]
... per-edit lines ...
[/applying]

[verify]
scope:      <files edited>
method:     bun run ui:smoke (gate("design"))
assertions: every route renders, no 5xx, no console errors; eyeballed <list>
[/verify]

# Summary
- <N> peers aligned
- <M> files edited
- <K> peers skipped (with reasons)
- Manual review suggested: <files>
```

## Guardrails

- **Verification is non-negotiable.** Never claim done without a green `gate("design")` result in the turn's tool output. `bun run build` alone is insufficient.
- **Approved findings only.** No fix without an approved finding (inline audit + user approval, or omnibus-passed approved SARIF).
- **Never propose fixes without showing the peer list first.** The user must be able to trim false positives before any edits.
- **Surface intentional divergence.** If a peer has `// conform:exempt` or an obvious comment indicating intentional difference, skip it and note in the report.
- **One reference, one pass.** Don't try to enforce multiple unrelated patterns in a single invocation.
- **No `Skill()` calls.** The omnibus dispatches; we apply.

## Cross-references

- Rule source: `src/rules/design/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Audit counterpart: `src/skills/design-audit/SKILL.md` (walks all 18 sections of `design/RULES.md`, including typography at B and accessibility/forms/perf at L-R)
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
- Progressive-disclosure detail: `references/dimensions.md`, `references/verification.md`, `examples/`
