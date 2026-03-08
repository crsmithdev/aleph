---
name: worktree
description: Create an isolated git worktree for a task. Prevents context contamination across concurrent work.
argument-hint: task-slug (e.g. feat/habits-schema)
---

Create a new git worktree for: $ARGUMENTS

1. Run: `git worktree add .claude/worktrees/$ARGUMENTS -b worktree-$ARGUMENTS`
   (omit -b if branch already exists)
2. Confirm the worktree path and show its absolute location
3. Show the current ISC or task description if one exists in the conversation
4. Remind: add `.claude/worktrees/` to `.gitignore` if not already present

Cleanup when done:
- **Commits ahead of base branch** -> prompt to open PR, then ask whether to keep or remove worktree
- **Uncommitted changes exist** -> warn and ask: commit first, stash, or discard
- **No commits ahead of base AND no uncommitted changes** -> remove worktree and branch automatically
