---
description: Apply a code pattern from one file across peers — pattern propagation OR consolidation onto a single source of truth.
---

Apply the `code-conform` skill using: $ARGUMENTS

Parse `$ARGUMENTS` into:

- **Reference** — first file path, file:section, or quoted phrase pointing at recent work. Required.
- **Scope** — optional glob, directory, or `within <path>` clause.
- **Notes** — free-form trailing text after `—` or `--notes`. Describes which dimensions to focus on or ignore.
- **Flags** — `--report` for audit-only (no fixes), `--all` to include legacy files (default: diff-only).

If `$ARGUMENTS` is empty, look at the most recent git diff and offer the most-recently-edited file as the reference.

## Execution

Activate the `code-conform` skill (`Skill(skill="code-conform")`) and follow its process:

1. Resolve the reference (read it).
2. Identify the distinctive pattern across the five dimensions (Structural, Compositional, Behavioral, Surface, Duplication-across-modules).
3. Find peers (auto-detect or use explicit scope). For the duplication axis, also grep for the inline shape across `src/`.
4. **Show the peer list — gate on user confirmation before any comparison work.**
5. Diff each peer against the reference along the chosen dimensions.
6. Report drift, prioritized Major / Minor / Aligned. Mark the shape: propagation or consolidation.
7. If reference is the minority, surface the outlier check.
8. **Gate on approval before any edits.**
9. Apply minimal edits (propagation) or rewrite peers to call the canonical helper and remove dead local copies (consolidation). Verify per `references/verification.md` (`bun test.ts`, `bun run --cwd src/ui build`, optional ast-grep).
10. Summarize.

## Examples

| `$ARGUMENTS` | Action |
|---|---|
| `src/research/src/providers/websearch.ts:fetchSearchResults` | Align tavilySearch / braveSearch / duckduckgoSearch error-handling shape |
| `src/ui/web/src/utils/format.ts:fmtToolName` | Consolidate inline `name.slice(5).split('__')` callers onto the centralized helper |
| `src/goals/src/services/todos.ts:createTodo — eventBus emissions only` | Behavioral: every state change emits a fully-populated AppEvent |
| `--report src/research/src/providers/openrouter.ts` | Audit only, no fixes |
| (empty) | Use most recent diff as reference |

## Notes

- This is the slash-command entry point for *code* conformance. For UI / layout / typography drift, use `/design-conform`. For pure typography correctness (smart quotes, em dashes), use `/design-type`.
- Conversational invocations like *"align the route handlers in app.ts"* trigger the skill directly via keyword rules.
- Always diff-only by default; `--all` opens the floodgates.
- The skill does not write a registry or config — every invocation is independent.
- For deep dimension definitions, see `src/skills/code-conform/references/dimensions.md`. For three worked cases, see `src/skills/code-conform/examples/`.
