# Construct

## Commandments

1. Favor simplicity, observability, testability, easy iteration. Write minimal, stable, debuggable code. No duplication, over-abstraction, or unnecessary complexity. Nothing fails silently.
2. Code over AI instructions; if it can be done without AI, don't use AI. TypeScript over Bash wherever possible.
3. Small, atomic changes that can be tested and reverted independently, frequent commits and usage of feature branches and worktrees.
4. Verify completion before claiming it. Test real end-to-end behavior in the way a user would interact with the system, not pieces in isolation.
5. Never summarize, truncate, or paraphrase when copying files; verify copies byte-for-byte.
6. Remove completely: all references, unused files, related artifacts, and every other trace. See the `code-review` skill for the full process.
7. All docs (README.md, INSTALL.md, SPEC.md, etc.) must match actual behavior with zero drift. SPEC.md should be behavior- and feature-oriented, enabling functional testing and diffing.
8. Use memory (MCP), CLAUDE.md, and docs appropriately without duplicating information between layers. Clearing context and continuing in a new session should be instant — never re-learn the codebase.
9. This runs on CLI in Claude Code and is globally installed. Don't touch ~/.claude unless installing. Source lives in `construct/` and `dotclaude/` at repo root; `.claude/` is dev config only. Project-root CLAUDE.md is project-specific.

## Testing Philosophy

- **Test behavior, not implementation.** If a refactor breaks your tests but not your code, the tests were wrong. Tests assert on observable outputs (stdout, exit codes, side effects), never internal state.
- **Test edges and errors, not just the happy path.** Every error path the code handles should have a test that triggers it. Malformed input, missing files, empty data.
- **Mock boundaries, not logic.** Only mock things that are slow, non-deterministic, or external. Hook tests pipe real JSON and check real output.
- **CI is the source of truth.** `bun test.ts` runs in GitHub Actions on every push. If CI passes, the code works.