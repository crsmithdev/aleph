---
name: git-worktrees
description: Use when setting up an isolated git worktree for parallel feature work. Handles directory selection, creation, and baseline verification.
---

# Git Worktrees

## When to Use

- Starting work that should be isolated from the current branch
- Running parallel feature development
- Need a clean environment for a specific task

## When NOT to Use

- Single-branch work with no isolation need
- Quick fixes on the current branch

## Process

### 1 — Choose directory

Priority order:
1. Check for existing `.worktrees/` or `worktrees/` directory
2. Check CLAUDE.md or project conventions for a preferred location
3. Ask the user

### 2 — Verify gitignore

If the worktree directory is inside the project, confirm it's in `.gitignore` before creating. Do not track worktree contents.

### 3 — Create worktree

```bash
git worktree add <path> -b <branch-name>
```

Branch name follows project conventions (`feature/`, `fix/`, etc.).

### 4 — Install dependencies

Auto-detect and run:
- `bun install` (if `bun.lock` or `package.json` exists)
- `npm install` (if `package-lock.json` exists)
- `cargo build` (if `Cargo.toml` exists)
- `pip install -r requirements.txt` (if exists)

### 5 — Verify baseline

Run the test suite in the new worktree. If tests fail before any changes, the worktree is not usable — investigate before proceeding.

## Done when

- Worktree created at a sensible location
- Directory is gitignored (if project-local)
- Dependencies installed
- Baseline tests pass

## Principles

- Verify before building — a worktree with failing baseline tests wastes time
- Auto-detect setup — don't hardcode package managers or test commands
- Clean up after yourself — remove worktrees when done (see `finishing-branch`)
