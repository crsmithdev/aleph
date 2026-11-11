# Sweep

Is this junk, or in the wrong place? A sweep acts only where a check answers yes or no. Nothing here turns on
whether a thing is worth keeping; the moment it does, it is a candidate for a lens.

That line runs through tests and docs, so place each one by where its check falls:

- A test whose subject no longer exists → **sweep**. The path does not resolve.
- A test that duplicates three others → the **one-way** lens. That is a judgment.
- A doc naming a path, command or flag that no longer resolves, or describing a design the code outgrew →
  [refit-docs](../refit-docs/SKILL.md) (its **true** and **copies** lenses).

## Tracked and untracked

Settle this before deleting anything. A tracked file is recoverable: `git rm` it and the content stays in
history. An untracked file has never been committed, so deleting it destroys the only copy.

**Delete tracked findings once their check passes. List untracked findings and get explicit confirmation, every
run.** An untracked file is often exactly the scratch a sweep hunts, and it is also the uncommitted work someone
left open. No check tells those apart.

## Find

The sweep runs over the whole repo; it is cheap. Take the baseline of the retro first (green build, tests and
lint from the manifest).

| Category | How to find it | The check |
|---|---|---|
| Build output and caches | The build config's output path; `coverage/`, `.cache/`, `*.tsbuildinfo`, `__pycache__`, `target/`, `dist/` | The build regenerates it |
| Scratch and one-off output | `*.log`, `*.tmp`, `*.bak`, `*.orig`, `.DS_Store`, dated or numbered names, `test2.ts`, `foo-copy.py` | No reference in the tree, no manifest or CI entry |
| Ignore-rule gaps | A **tracked** file matching a build-output or machine-local shape | The file rebuilds, or it is local to one machine |
| Orphaned fixtures and tests | For each test and fixture, resolve the subject it names | The subject is absent from the tree **and** from `HEAD` |
| Misplaced files | A file whose kind disagrees with its directory | The repo's own convention: the majority of that kind live elsewhere |

**Misplaced files** need a stated threshold rather than a guess: the convention is the majority. If eleven hooks
live in `hooks/` and one lives in `bin/`, the one is misplaced; a two-versus-three split is not a convention and
not a finding.

## Apply

Sort every finding into **remove**, **relocate**, or **hand to a lens**, and say which.

`git rm` for tracked removals, `git mv` for relocations so history follows the file, plain `rm` for untracked
ones once confirmed. Fix the imports and config entries a relocation breaks in the same commit as the move. Add
the ignore rule alongside any deletion of a file that will come back: an artifact removed without its rule
returns on the next build.

Then run the baseline commands and commit. The sweep is done when **every category in the table has a result**
(findings, or "none"), every finding is sorted, the baseline commands are green, and the changes are committed.

## Report

In the terminal: the files and lines removed against the baseline, one row per finding grouped by outcome
(removed, relocated, handed on), the ignore rules added, and the untracked files the user declined.
