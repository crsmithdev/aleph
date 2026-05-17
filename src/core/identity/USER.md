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
- Values working code over perfect code — iterate, don't gold-plate
- Reads diffs, not explanations — show the change, not a paragraph about it
- Commits often — small, atomic, on feature branches

## Communication Preferences

- Don't ask "shall I proceed?" — just do it
- Flag blockers and ambiguity immediately, don't guess
- If something breaks, show the error, not your interpretation of it

## Git

- Commit messages: imperative mood, lowercase, no trailing punctuation, 50 chars max
- Body only when the "why" isn't obvious from the diff
- No emoji, no conventional-commit prefixes
- Branch names: terse, use `feature/`, `fix/`, `refactor/`, or `docs/` prefix
- Each logical change gets its own feature branch (use worktrees for parallel work)
