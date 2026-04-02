---
name: finishing-branch
description: Use when development on a feature branch is complete and ready to integrate. Verify, then merge/PR/keep/discard.
compatibility: Designed for Claude Code
---

# Finishing a Branch

## When to Use

- Feature branch work is complete and verified
- Ready to integrate, park, or discard a branch

## When NOT to Use

- Tests are still failing — fix first
- Work is incomplete — finish or park explicitly

## Process

### 1 — Verify

Run the full test suite. Do not proceed if any test fails.

### 2 — Determine base branch

Identify the branch this was forked from (usually `main`).

### 3 — Present options

Offer exactly four choices:

1. **Merge** — squash merge to base branch, delete feature branch
2. **PR** — push and create a pull request
3. **Keep** — leave the branch as-is for later
4. **Discard** — delete the branch and its changes (requires typed confirmation)

### 4 — Execute

| Option | Steps |
|--------|-------|
| Merge | `git checkout <base>` → `git merge --squash <branch>` → commit → delete branch |
| PR | Push with `-u` → `gh pr create` → report URL |
| Keep | Push if not already pushed → report branch name |
| Discard | Confirm with user → `git checkout <base>` → delete branch |

### 5 — Clean up worktree

If working in a git worktree, remove it for Merge and Discard. Keep it for PR and Keep.

## Done when

- Tests verified passing before any integration action
- Chosen option executed successfully
- Worktree cleaned up if applicable

## Principles

- Never merge with failing tests
- Discard requires explicit confirmation — not a default
- Report what was done (merge commit, PR URL, branch name)
