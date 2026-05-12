---
description: Apply a UI pattern from one file across peers — layout, component composition, state coverage, tokens.
---

Apply the `design-fix` skill using: $ARGUMENTS

Parse `$ARGUMENTS` into:

- **Reference** — first file path, file:section, or quoted phrase pointing at recent work. Required.
- **Scope** — optional glob, directory, or `within <path>` clause.
- **Notes** — free-form trailing text after `—` or `--notes`. Describes which dimensions to focus on or ignore.
- **Flags** — `--report` for audit-only (no fixes), `--all` to include legacy files (default: diff-only).

If `$ARGUMENTS` is empty, look at the most recent git diff and offer the most-recently-edited UI file as the reference.

## Execution

Activate the `design-fix` skill (`Skill(skill="design-fix")`) and follow its process:

1. Resolve the reference (read it; load it in the browser if helpful).
2. Identify the distinctive pattern across the five dimensions (Layout, Composition, State coverage, Tokens, Microcopy).
3. Find peers (auto-detect or use explicit scope). Auto-detect includes consumers of the same layout primitive.
4. **Show the peer list — gate on user confirmation before any comparison work.**
5. Diff each peer against the reference along the chosen dimensions.
6. Report drift, prioritized Major / Minor / Aligned.
7. If reference is the minority, surface the outlier check.
8. **Gate on approval before any edits.**
9. Apply minimal edits, prefer shared primitives over hand-rolled markup. Verify per `references/verification.md` (`bun run ui:smoke` is required, plus eyeball check on the affected routes).
10. Summarize.

## Examples

| `$ARGUMENTS` | Action |
|---|---|
| `src/ui/web/src/components/data/DataTable.tsx` | Peers = consumers; align column typing, formatters, sortability |
| `src/ui/web/src/components/layout/PageHeader.tsx` | Peers = consumers; align title font, breadcrumb usage, h-14 chrome |
| `src/ui/web/src/pages/system/observability/EvalsPage.tsx — table only` | Narrow to the table; ignore page-level chrome |
| `the loading state across all detail pages` | No fixed anchor; skill picks the cleanest, asks for confirmation |
| `--report src/ui/web/src/pages/system/SettingsPage.tsx` | Audit only, no fixes |
| (empty) | Use most recent diff as reference |

## Notes

- This is the slash-command entry point for *design* conformance. For logic / behavior / data-flow drift, use `/code-conform`. For pure typography correctness (smart quotes, em dashes), `/design-audit` flags violations as `tag: typography` findings citing `design/RULES.md#B`. For full UI audits with no specific reference, use `/design-audit`.
- Conversational invocations like *"make the other detail pages match X"* or *"same loading state everywhere"* trigger the skill directly via keyword rules.
- Always diff-only by default; `--all` opens the floodgates.
- The skill does not write a registry or config — every invocation is independent.
- `bun run ui:smoke` is the required verification gate. Build alone is not sufficient (per `feedback_ui_done_requires_page_load`).
- For deep dimension definitions, see `src/skills/design-fix/references/dimensions.md`. For three worked cases, see `src/skills/design-fix/examples/`.
