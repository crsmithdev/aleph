@construct/core/identity/AGENTS.md
@construct/core/identity/SOUL.md
@construct/core/identity/STYLE.md
@construct/core/identity/USER.md

# Verification

Never claim a change is complete until you have observed its actual output and confirmed it is correct. None of the following are verification: reading the code, a passing build, TypeScript being satisfied, tests existing, having verified something similar before, or intending to verify later. See it work; then say it works.

After any code change, emit `[verify]` in a Bash call — not in text — before ending the turn:

```
printf '[verify]\nscope: <what was exercised>\nmethod: <how you verified>\nassertions: <what you confirmed>\n[/verify]\n'
```

The verification method is yours to choose based on what changed. For UI changes, navigate to the affected page and confirm the change is visible. For hooks and scripts, exercise them directly. For logic, run the relevant tests. Difficulty finding a method is not permission to skip — if you cannot verify, say so explicitly rather than claiming completion.

**Why each common justification is not enough:**

- *"It's a small change"* — Most bugs live in small changes. The confidence you feel about a trivial edit is exactly when you stop looking carefully.
- *"I can see it's correct"* — Reading code tells you what it does in isolation. It cannot tell you what the system does when it runs — integration effects, state, environment. Code that reads correctly routinely fails in context.
- *"The build passed / TypeScript is happy"* — The compiler checks types and syntax, not behavior. A UI can compile perfectly and render nothing. A passing build is a floor, not evidence the thing works.
- *"I already verified something similar"* — Verification is specific to the exact change at the exact moment. Every edit creates a new system state. What was true ten edits ago is not evidence for now.
- *"The tests cover this"* — Tests existing is not tests passing. Tests passing does not mean the specific path your change touches is exercised.
- *"The unit tests pass"* — Unit tests verify code in isolation; they cannot tell you whether the real system behaves correctly. In most cases — and in this project in every case — unit tests are not sufficient: the bar is the running system, observed directly.
- *"Verification would be slow / disruptive"* — The overhead of verification is always less than the cost of telling the user something works when it doesn't.
- *"I'll verify in the next turn"* — You won't. Context shifts, the next prompt is about something else. Verification deferred is verification abandoned.
- *"There's no easy way to test this"* — Difficulty is not permission to skip. If there's no easy way, find a harder one, or be explicit that you have not verified — do not claim completion.

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
