---
name: git-workflow
description: Full git workflow for code changes — isolate work in a branch or worktree, implement, then land via merge, PR, or discard. Use when starting any code task or finishing/landing a branch.
compatibility: Designed for Claude Code
---

# Git Workflow

## When to Use

- Starting any code task that should not happen directly on `main`
- Finishing a branch and landing (merge, PR, or discard)

---

## Phase 1: Isolate

### Scope Decision

| Change type | Setup |
|---|---|
| Small / contained (1–3 files, clear outcome) | Feature branch |
| Large / uncertain / parallel / architectural | Worktree |

When in doubt, prefer a worktree — easier to clean up than a messy main branch.

### Branch Naming

```
feature/<description>     # new functionality
fix/<description>         # bug fixes
hotfix/<description>      # urgent production fixes
refactor/<description>    # code cleanup with no behavior change
experiment/<description>  # spikes, POCs
```

Use kebab-case, keep it short and descriptive.

### Path A — Feature Branch

```bash
git checkout -b <branch-name>
```

No further setup needed — proceed with the work.

### Path B — Worktree

**1. Choose directory** (priority order):
1. Existing `.worktrees/` or `worktrees/` directory in project
2. CLAUDE.md preference
3. Default to `.worktrees/<branch-name>`

**2. Verify gitignore** — if worktree directory is inside the project, confirm it's in `.gitignore` before creating:

```bash
git check-ignore -q .worktrees
```

If not ignored, add it to `.gitignore` and commit first.

**3. Create worktree:**

```bash
git worktree add <path> -b <branch-name>
```

**4. Install dependencies** (auto-detect):

```bash
# run whichever applies
bun install        # bun.lock or package.json
npm install        # package-lock.json
cargo build        # Cargo.toml
pip install -r requirements.txt
```

**5. Verify baseline** — run the test suite. If tests fail before any changes, the worktree is not usable — investigate before proceeding.

---

## Phase 2: Land

**Announce at start:** "I'm using the git-workflow skill to land this work."

### Step 1: Verify Tests

```bash
npm test / cargo test / pytest / go test ./...
```

If tests fail — show failures, stop. Do not proceed until passing.

### Step 2: Determine Base Branch

```bash
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

### Step 3: Present Options

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

### Step 4: Execute Choice

#### Option 1: Merge Locally

```bash
git checkout <base-branch>
git pull
git merge <feature-branch>
<test command>            # verify on merged result
git branch -d <feature-branch>
```

Then: cleanup worktree (Step 5).

#### Option 2: Push and Create PR

```bash
git push -u origin <feature-branch>

gh pr create --title "<type>(<scope>): <description>" --body "$(cat <<'EOF'
## What
<what this PR does>

## Why
<motivation and context>

## Test Plan
- [ ] <verification steps>
EOF
)"
```

Then: cleanup worktree (Step 5).

#### Option 3: Keep As-Is

Report: "Keeping branch `<name>`. Worktree preserved at `<path>`."

Do not cleanup worktree.

#### Option 4: Discard

Confirm first:

```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path> (if applicable)

Type 'discard' to confirm.
```

Wait for exact confirmation, then:

```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

Then: cleanup worktree (Step 5).

### Step 5: Cleanup Worktree (Options 1, 2, 4 only)

```bash
git worktree list | grep <branch-name>   # check if worktree exists
git worktree remove <worktree-path>
```

---

## Commit Messages

Use conventional commits format:

```
<type>(<scope>): <subject>

[optional body — explain why, not what]

[optional footer — Breaking changes, Closes #issue]
```

| Type | Use For |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change with no behavior change |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Maintenance, deps |
| `perf` | Performance improvement |

---

## Conflict Resolution

```bash
git status                              # see conflicted files
# edit files to resolve <<<<< markers, then:
git add <resolved-file>
git commit

# shortcuts:
git checkout --ours <file>             # keep base branch version
git checkout --theirs <file>           # keep feature branch version
git mergetool                          # open visual merge tool
```

---

## Recovery

```bash
# undo last commit, keep changes staged
git reset --soft HEAD~1

# undo last commit, discard changes
git reset --hard HEAD~1

# undo a pushed commit (safe — creates new commit)
git revert HEAD
git push

# restore a single file to HEAD
git checkout HEAD -- path/to/file

# stash work in progress
git stash push -m "WIP: <description>"
git stash pop                          # restore most recent stash
git stash list                         # list all stashes
```
