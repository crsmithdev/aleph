@construct/core/identity/AGENTS.md
@construct/core/identity/SOUL.md
@construct/core/identity/STYLE.md
@construct/core/identity/USER.md

# Sessions and worktrees

If you are going to make code changes on a feature branch, work in a worktree at `.worktrees/<short-name>/` rather than the repo's main checkout. Never `git checkout` a feature branch in the main tree — multiple agent sessions can share that tree, and switching branches there will yank another session's checkout out from under them.

Concretely:

- For new feature work: `git worktree add .worktrees/<name> -b <branch> main`, then `cd` into it.
- The repo's main checkout stays on `main` and serves as a reference / dev-server source.
- Verify worktree changes with `bun test.ts` and `bun run build` from inside the worktree, not against the main tree's dev server (which is running different code).
- When the work lands on `main`, remove the worktree: `git worktree remove .worktrees/<name>`.

Trivial in-place edits to `main` (a doc fix, a one-line config tweak you intend to push immediately) don't need a worktree, but anything you'd commit to a feature branch does.

# Memory

Use `memory_search` at session start and `memory_store` during/after work.

Store on: approach decisions, user corrections, unexpected failures+fixes, discovered patterns, session summaries.

Each call requires `content` (1-3 sentences, specific and actionable) and `tags` matching the categories above.
