# Verification Gates

Per-domain verification commands. Skills and the omnibus orchestrator read this table to decide what to run before claiming a fix is done. Skills must not hardcode gate commands — they call `gate("<domain>")` and the resolution happens here.

When you add a new domain or change how a domain is verified, update this table and nothing else.

## Gates

| Domain | Gate command | Notes |
|---|---|---|
| `code` | `bun test.ts` | Runs all backend tests. Required after any change under `src/` that isn't UI or docs. |
| `design` | `bun run ui:smoke` (in `src/ui`) | Builds the bundle, boots the API, navigates every route in headless Chromium. Required after any change under `src/ui/` or any change that affects routes/types the UI consumes. |
| `docs` | `bun run docs:check` *(not yet implemented — falls back to manual review)* | Markdown lint + cross-reference resolution + frontmatter parse. Pending implementation. |
| `skills` | `bun test src/skills` *(scoped subset of code)* | Validates skill frontmatter, registry entries, and reference-file resolution. |
| `hooks` | `bun test src/core/hooks` | Pipes test JSON to each affected hook, asserts stdout / exit codes. Required after any change under `src/core/hooks/`. |
| `agents` | *(no automated gate yet)* | Subagent definitions are validated by agnix; behavioral verification is manual. |
| `config` | `agnix --dry-run .` | Structural lint of CLAUDE.md, settings.json, MCP, AGENTS.md. Optional if agnix not installed. |
| `security` | `bun test src/security` *(future)* | Fast local check. Deeper security review remains manual until rules are populated. |

## Combined gates

When a change touches multiple domains, the omnibus runs each affected gate. Order:

1. `code` and `hooks` first (fast, fails early on basic correctness).
2. `design` (slower because of browser).
3. `docs` (cheap; runs in parallel with design when implemented).
4. `security` (local gate is fast and runs with `code`).

## Resolution semantics

- A skill calling `gate("foo")` for a missing domain logs a warning and proceeds (does not block).
- A gate that exits non-zero blocks `claim-of-done` until green.
- A gate marked *(no automated gate yet)* returns success after surfacing a manual-review prompt; this is a documented gap, not a feature.

## Adding a domain

When adding a domain to the skill matrix (per `docs/plans/skill-architecture.md`):

1. Add the row here with the actual gate command and a one-line "Notes" entry.
2. If the gate doesn't exist yet, add it as a pending row with the *(future)* marker and a brief plan.
3. Update `omnibus.yml` `verification:` block to mirror this table.

## Aleph-specific cross-references

- `code` gate alone is insufficient for UI changes — compilation and a smoke pass do not prove a page renders. Any change that touches `src/ui/**`, a UI-consumed API route, or shared types must run the `design` gate too.
- `hooks` gate must be paired with `bun install.ts` if the change deploys to `~/.claude/aleph/`. The install runs `test.ts` automatically, so a clean install + `systemctl --user status aleph-ui` is the end-to-end pass.
- For worktree changes, gates run inside the worktree — not against the dev server on port 3001 (which serves different code).
