<!-- DEV-ONLY — loaded at runtime for this repo, never installed anywhere.
     Construct behavioral rules live in src/core/CLAUDE.md (installed to ~/.claude/CLAUDE.md).
     Keep behavioral rules in src/core/CLAUDE.md; put dev-only rules here. -->

# Construct Development

This is the Construct source repo. The installed Construct rules come from `~/.claude/CLAUDE.md`.

## Commandments

1. Architecture should favor simplicity, testability, fast iteration; it should be easy to test and debug code.  Nothing may fail silently.
2. Code should be minimal, concise, use modern patterns, libraries where possible, and avoid over-abstraction or unnecessary complexity.  
3. Rely on code over AI instructions; if it can be done without AI, don't use AI. TypeScript over Bash wherever possible.
4. Make small, atomic changes that can be tested and reverted independently, frequent commits, feature branches, and worktrees. Push before context switches or session end. Push after every verified change; never accumulate uncommitted work.
5. Never claim something is finished or fixed unless you have tested it on the actual running system and verified the real output.  Do not assume correctness, skip tests, or finish unless **all** tests are passing.
6. Never summarize, truncate, or paraphrase when copying files; verify copies byte-for-byte.
7. When removing something, remove it completely: all references, unused files, related artifacts, and every other trace.  Do not let orphaned / 'legacy' features pile up if outdated.
8. All docs (README.md, INSTALL.md, SPEC.md, etc.) must match actual behavior with zero drift. SPEC.md should be behavior- and feature-oriented, enabling functional testing and diffing.
9. Use memory (MCP), CLAUDE.md, and docs appropriately without duplicating information between layers. Clearing context and continuing in a new session should be instant — never re-learn the codebase.
10. Never write to `~/.claude/` directly — use `bun install.ts` to deploy. Dev changes are served live from `src/` via `bun run start` in `src/ui/`.

## Avoiding duplication

Claude Code merges `.claude/` (project) with `~/.claude/` (global) at runtime. If the same hook, command, or setting exists in both, it fires/loads twice. To prevent this:

- Put hooks, commands, and CLAUDE.md rules in `src/` (installed to `~/.claude/construct/`), not `.claude/`.
- `.claude/settings.json` may only contain permissions, statusline, and MCP server config — hooks go in `src/`.

**CLAUDE.md ownership** — rules must exist in exactly one place (this file supplements but does not override global rules):
- `src/core/CLAUDE.md` → Construct behavioral rules. Referenced via `@construct/core/CLAUDE.md` in `~/.claude/CLAUDE.md`. Takes precedence as the authoritative behavioral source.
- `.claude/CLAUDE.md` → this file. Repo-specific dev rules. Loaded at runtime, never installed.

## Testing Philosophy

- **Test behavior, not implementation.** If a refactor breaks your tests but not your code, the tests were wrong. Tests assert on observable outputs (stdout, exit codes, side effects), never internal state.
- **Test edges and errors, not just the happy path.** Every error path the code handles should have a test that triggers it. Malformed input, missing files, empty data.
- **Mock boundaries, not logic.** Only mock things that are slow, non-deterministic, or external. Hook tests pipe real JSON and check real output.
- **CI is the source of truth.** `bun test.ts` runs in GitHub Actions on every push. If CI passes, the code works.

## Server

- **Dev:** port 3001 — `bun dev-server.ts` from repo root, Vite HMR, live from `src/`
- **Prod:** port 3000 — systemd `construct-ui.service`, deployed via `/install`

Always develop against **port 3001**. Both share data at `~/.construct/`.

The dev server is **usually already running** at http://localhost:3001. Check with `ss -tlnp | grep 3001` before starting a new one. **Never use any other port** (3002, etc.) — only 3000 and 3001 exist for this project.

## Dev workflow

1. Edit source in `src/`
2. Changes are served live via Vite HMR — **no restart needed** for UI changes; API changes are picked up via `--watch`
3. Run `bun test.ts` to verify
4. Run `bun install.ts` **only** to deploy to production (port 3000) — not required to see or verify dev changes

After any install, verify with `systemctl --user status construct-ui` and `curl http://localhost:3000/api/system/info`.

## Verification in worktrees

When working in a worktree (`.worktrees/<name>`), the main repo's dev server at 3001 is running **different code**. Do not use it for worktree verification.

**Correct verification for worktree changes:**
- `bun test.ts` from the worktree root — sufficient for backend logic, hooks, API routes
- `bun run build` in `src/ui` — catches frontend type errors and build failures
- For live HTTP testing: `kill $(ss -tlnp | grep 3001 | grep -oP 'pid=\K[0-9]+')` then `bun run --cwd src/ui start` from the **worktree root**

**Never** start a server on port 3002 or any non-standard port.

## Directory map

| Path | Purpose | Installs to | Method |
|---|---|---|---|
| `src/` | All Construct code: hooks, skills, commands, CLAUDE.md, settings | `~/.claude/construct/` | `bun install.ts` |
| `.claude/` | Project-local dev config (this file, permissions, statusline) | nowhere — used at runtime | — |
| `~/.claude/construct/` | Installed code | — | Only written by `install.ts` |
| `~/.construct/` | User data (DB, sessions, signals, memory) | — | Never touched by install |

## Skill extensions

### /code-review

**Scope:** All `.ts` files under `src/` and the installer (`install.ts`, `test.ts`).

**Additional checks:**

- **Hook integrity:** every hook command in `src/core/hooks/settings-hooks.json` points to a file that exists; every hook handles malformed stdin (JSON parse → exit 1); every hook uses `trace()` from `src/trace.ts`; no hook writes to stdout unless it has a meaningful message
- **Duplication guard:** nothing in `.claude/` duplicates what's in `src/core/hooks/settings-hooks.json` (double-fire risk); CLAUDE.md rules exist in exactly one location per the ownership table
- **Backwards-compat cruft:** look for shims, wrappers, or fallbacks kept "for backwards compat" that nothing reads anymore; check for old file paths, renamed exports, deprecated aliases, or stale config keys; if the only consumer was removed, the compat layer is dead — remove it
- **Install roundtrip:** run `bun install.ts` && `bun test.ts` after review; installed copies must match sources byte-for-byte

### /debugging

**Additional checks:**

- **Hook fails silently:** check exit code, pipe `2>&1` to capture stderr, check telemetry for hook events

### /docs-review

**Scope:**

| Document | Truth source |
|---|---|
| `README.md` | Actual directory layout, hook registrations, slash commands |
| `INSTALL.md` | Actual installer behavior, preserved files, prerequisites |
| Module `README.md` | Actual module contents and hook behavior |
| Module `INSTALL.md` | Actual verification results (run the checks) |
| `SPEC.md` | Actual hooks, commands, skills, behavior |
| `CLAUDE.md` | Actual behavior (are rules followed? do referenced files exist?) |
| Skill `SKILL.md` | Actual skill-rules.json keywords, skill directory contents |

**Additional checks:**

1. Every hook registered in `src/core/hooks/settings-hooks.json` is documented in the Hook Registration table
2. Every slash subcommand in `construct.md` is documented
3. Every skill in `skill-rules.json` is documented
4. Every module detection file listed matches reality
5. Flag any behavior described in `SPEC.md` that has no corresponding implementation

### /verification

**Additional checks:**

| Claim | Requires | Not sufficient |
|---|---|---|
| Install works | Run `bun install.ts` (verify runs automatically) | "Files copied" |
| Docs match behavior | Run docs-review skill | "I updated the docs" |
| Hook works | Pipe test input, check stdout | "Code looks correct" |
