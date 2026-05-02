---
description: Apply a pattern from one file across similar files in the codebase — ad-hoc consistency enforcement with the reference as the spec.
---

Apply the `conform` skill using: $ARGUMENTS

Parse `$ARGUMENTS` into:

- **Reference** — first file path, file:section, or quoted phrase pointing at recent work. Required.
- **Scope** — optional glob, directory, or `within <path>` clause.
- **Notes** — free-form trailing text after `—` or `--notes`. Describes which dimensions to focus on or ignore.
- **Flags** — `--report` for audit-only (no fixes), `--all` to include legacy files (default: diff-only).

If `$ARGUMENTS` is empty, look at the most recent git diff and offer the most-recently-edited file as the reference.

## Execution

Activate the `conform` skill (`Skill(skill="conform")`) and follow its process:

1. Resolve the reference (read it).
2. Identify the distinctive pattern (narrowed by notes if given).
3. Find peers (auto-detect or use explicit scope).
4. **Show the peer list — gate on user confirmation before any comparison work.**
5. Diff each peer against the reference along the chosen dimensions.
6. Report drift, prioritized Major / Minor / Aligned.
7. If reference is the minority, surface the outlier check.
8. **Gate on approval before any edits.**
9. Apply minimal edits, verify per project rules (`bun test.ts`, `bun run build`, `bun run ui:smoke` as relevant).
10. Summarize.

## Examples

| `$ARGUMENTS` | Action |
|---|---|
| `ResearchQueryDetailPage.tsx` | Find peer detail pages, align all dimensions |
| `ResearchTable.tsx — header row only` | Peer tables, narrow to header structure |
| `app.ts:research handler within routes/` | Section reference, scoped to one directory |
| `--report ResearchQueryDetailPage.tsx` | Audit only, no fixes |
| (empty) | Use most recent diff as reference |

## Notes

- This is the slash-command entry point. Conversational invocations like *"make the other detail pages match X"* trigger the skill directly via keyword rules.
- Always diff-only by default; `--all` opens the floodgates.
- The skill does not write a registry or config — every invocation is independent.
