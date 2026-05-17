---
description: Start and complete feature work in isolated worktrees — handles single or multiple features
---
Manage feature development. Parse the user's intent from: $ARGUMENTS

## Starting a feature

When the user provides a feature name or description (or none — ask), invoke `git-workflow` (Phase 1: Isolate) to set up an isolated worktree:

```
Skill("git-workflow")
```

Then proceed with implementation. For multiple features, set up one worktree per feature and work through them sequentially or in parallel per user preference.

## Finishing a feature

When implementation is complete and tests pass, invoke `git-workflow` again (Phase 2: Land) to handle merge, PR, or cleanup:

```
Skill("git-workflow")
```

## Multiple features

If `$ARGUMENTS` lists more than one feature (comma-separated, numbered, or bulleted), confirm the list with the user, then:

1. Set up worktrees for all features upfront, or one at a time — ask if unclear
2. Work through each feature
3. Run `git-workflow` (Phase 2) after each one completes

## Output format

Keep status updates to one line per feature. Show worktree path and branch name when created.
