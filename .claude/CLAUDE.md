<!-- DEV-ONLY — loaded at runtime for this repo, never installed anywhere.
     Construct behavioral rules live in dotclaude/CLAUDE.md (installed to ~/.claude/CLAUDE.md).
     Do not duplicate rules between this file and dotclaude/CLAUDE.md. -->

# Construct Development

This is the Construct source repo. The installed Construct rules come from `~/.claude/CLAUDE.md`.

## Commandments

1. Architecture should favor simplicity, testability, fast iteration; it should be easy to test and debug code.  Nothing may fail silently.
2. Code should be minimal, concise, use modern patterns, libraries where possible, and avoid over-abstraction or unnecessary complexity.  
3. Rely on code over AI instructions; if it can be done without AI, don't use AI. TypeScript over Bash wherever possible.
4. Make small, atomic changes that can be tested and reverted independently, frequent commits, feature branches, and worktrees. Push before context switches or session end.  Push code frequently and avoid accumulating un-commited changes.
5. Never claim something is finished or fixed unless you have tested it on the devserver, and looked at the actual data that the page contains.  Do not assume correctness, skip tests, or finish unless **all** tests are passing.
6. Never summarize, truncate, or paraphrase when copying files; verify copies byte-for-byte.
8. When removing something, remove it completely: all references, unused files, related artifacts, and every other trace.  Do not let orphaned / 'legacy' features pile up if outdated.
7. All docs (README.md, INSTALL.md, SPEC.md, etc.) must match actual behavior with zero drift. SPEC.md should be behavior- and feature-oriented, enabling functional testing and diffing.
9. Use memory (MCP), CLAUDE.md, and docs appropriately without duplicating information between layers. Clearing context and continuing in a new session should be instant — never re-learn the codebase.
10. Rigorously keep dev (this repo) isolated from production (`~/.claude`).  Everything:  modules, SQLite DB, telemetry DB, memory mcp server, etc. must be different between both environments.  Never write to `~/.claude` unless installing, and never test against it either, all testing should be done in the dev environment.

## Testing Philosophy

- **Test behavior, not implementation.** If a refactor breaks your tests but not your code, the tests were wrong. Tests assert on observable outputs (stdout, exit codes, side effects), never internal state.
- **Test edges and errors, not just the happy path.** Every error path the code handles should have a test that triggers it. Malformed input, missing files, empty data.
- **Mock boundaries, not logic.** Only mock things that are slow, non-deterministic, or external. Hook tests pipe real JSON and check real output.
- **CI is the source of truth.** `bun test.ts` runs in GitHub Actions on every push. If CI passes, the code works.

## Dev workflow

1. Edit source in `src/` and `dotclaude/`
2. Run `bun test.ts` to verify
3. Use `/devserver` for UI work (ports 5174/3002, isolated from production)
4. Run `bun install.ts` **only when ready to deploy** — never during active development

`bun install.ts` stops the production UI service, overwrites `~/.claude/construct/`, reinstalls deps, and restarts the service. Running it mid-development crashes the production server and is unnecessary — the dev server reads from `src/` directly.

## Directory map

| Path | Purpose | Installs to | Method |
|---|---|---|---|
| `src/` | Hook code, skills, identity files | `~/.claude/construct/` | Sync (overwrite + delete stale) |
| `dotclaude/` | CLAUDE.md rules, settings (hooks), commands | `~/.claude/` | Merge (overwrites Construct-owned content, preserves the rest) |
| `.claude/` | Project-local dev config (this file, permissions, statusline) | nowhere — used at runtime | — |
| `~/.claude/` | Installed runtime | — | Read-only; only written by `bun install.ts` |

## Avoiding duplication

Claude Code merges `.claude/` (project) with `~/.claude/` (global) at runtime. If the same hook, command, or setting exists in both, it fires/loads twice. To prevent this:

- **Never** put hooks, commands, or CLAUDE.md rules in `.claude/`. Those belong in `dotclaude/` (installed to `~/.claude/`).
- `.claude/settings.json` may only contain permissions, statusline, and MCP server config — never hooks.

**CLAUDE.md ownership** — rules must exist in exactly one place:
- `dotclaude/CLAUDE.md` → install source for `~/.claude/CLAUDE.md`. Construct-managed behavioral rules (behavior, task execution, memory, git, personas). Not loaded directly by Claude Code.
- `.claude/CLAUDE.md` → this file. Repo-specific dev rules (commandments, testing philosophy, dev workflow, directory map). Loaded at runtime, never installed.
