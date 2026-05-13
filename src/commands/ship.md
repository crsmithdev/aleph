---
name: ship
description: Merge all outstanding feature branches and worktrees to main (squashed), then push to GitHub.
---

# Ship

Merge every outstanding feature branch into main and push.

## Process

### 1 — Inventory

Discover all branches and worktrees that need shipping:

```bash
git worktree list
git branch --no-merged main
```

Also check for uncommitted changes on any worktree or the current branch. If there are unstaged/uncommitted changes anywhere, commit them first (ask for a message if intent is unclear).

List what you found and confirm with the user before proceeding. Show: branch name, commit count ahead of main, and worktree path (if any).

### 2 — Validate

For each branch:
1. Rebase onto latest main (abort and report if conflicts arise)
2. Run the test suite (`bun test.ts`, `npm test`, or whatever the project uses) — skip this step if no test runner is detected
3. If tests fail, stop and report. Do not merge a failing branch.

### 3 — Squash merge

For each validated branch, in order:

```bash
git checkout main
git merge --squash <branch>
git commit -m "<branch summary>"
```

Use the branch name and its commit messages to write a concise squash commit message (imperative mood, lowercase, no prefix). If a branch has a single commit, reuse its message.

### 4 — Clean up

For each merged branch:
- Delete the local branch: `git branch -D <branch>`
- Remove the worktree if one exists: `git worktree remove <path>`
- Delete the remote branch if one exists: `git push origin --delete <branch>`

### 5 — Push

```bash
git push origin main
```

### 6 — Report

Summary table:

| Branch | Commits | Status |
|--------|---------|--------|
| feature/foo | 3 → 1 squashed | merged + pushed |

## Principles

- Never force-push main
- Never merge with failing tests
- Always confirm the branch list before merging
- If any branch has conflicts, stop and report — don't silently skip it
