# User

Who the principal is. Preferences, environment, constraints.

## Profile

- Name: Chris Smith
- Timezone: Pacific
- Role: Human being, software engineer

## Environment

- OS: WSL2 on Windows 11
- Shell: bash
- Editor: VS Code
- Cores: 23
- Terminal: Windows Terminal
- Email: crsmithdev@gmail.com

## Tech Stack

- Languages: TypeScript (primary), Python, occasionally Go/Rust
- Runtime: bun (preferred), node
- Package manager: bun
- Frameworks: React, Fastify, Vite
- Database: SQLite (`bun:sqlite`)
- AI/LLM: Claude (via Claude Code CLI), occasional OpenRouter for cheap models
- Deploy: self-hosted (systemd on WSL2 Linux)

## Project Context

- Primary project: **Construct** — Claude Code-native personal AI infrastructure (research engine, hooks, skills, agents, observability UI). Source at `~/construct/`, installs to `~/.claude/construct/` via `bun install.ts`. User data lives at `~/.construct/`.
- Dev server on port 3001, prod on port 3000 (systemd `construct-ui.service`).

## Working Style

- Prefers autonomous execution — ask permission only for destructive/irreversible actions
- Wants terse output — no padding, no preamble, no filler
- Values working code over perfect code — iterate, don't gold-plate
- Reads diffs, not explanations — show the change, not a paragraph about it
- Parallelizes aggressively — use all available cores and subagents
- Commits often — small, atomic, on feature branches

## Communication Preferences

- Don't ask "shall I proceed?" — just do it
- Don't summarize what you're about to do — do it, then report
- Flag blockers and ambiguity immediately, don't guess
- If something breaks, show the error, not your interpretation of it

## Verification

<!-- eval-target:e2e — this block is tuned by the compliance eval optimizer -->
- Always verify by running the actual system and observing correct behavior end-to-end before claiming a change is done.
- Run the real server, CLI, or process and interact with it — unit tests alone are insufficient.
<!-- end eval-target:e2e -->

## Git

- Commit messages: imperative mood, lowercase, no trailing punctuation, 50 chars max
- Body only when the "why" isn't obvious from the diff
- No emoji, no conventional-commit prefixes
- Branch names: terse, use `feature/`, `fix/`, `refactor/`, or `docs/` prefix
- Each logical change gets its own feature branch (use worktrees for parallel work)
<!-- eval-target:commit — this line is tuned by the compliance eval optimizer -->
- Commit after every verified change; never declare work done with uncommitted changes
<!-- end eval-target:commit -->
- Push after changes are accepted
- Squash commits when merging
