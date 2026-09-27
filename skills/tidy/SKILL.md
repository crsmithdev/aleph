---
name: tidy
description: Sweep a repo for build output, scratch files, stray temp data, orphaned fixtures, ignore-rule gaps and misplaced files, then remove or relocate each one. Mechanical only: every removal is backed by a check that answers yes or no. Use when the user asks to tidy a repo, clear out leftover or stray files, fix where files live, or find what should not be committed. Triggers on "tidy the repo", "clean up these files", "what junk is in here", "/tidy". NOT for dead code, unused exports or unused dependencies, which need judgment (use /aleph:cull).
---

# Tidy

Sweep the repo for things that are junk or in the wrong place. Fast enough to run before a commit.

**The mechanical rule: every finding rests on a check that answers yes or no.** The path does not resolve. The rule matches. The command exits non-zero. Nothing here turns on whether a thing is worth keeping. The moment a finding needs that judgment it belongs to `/aleph:cull`: record it as a hand-off and keep sweeping.

That line runs straight through tests and docs, so put it where the check falls:

- A test whose subject no longer exists → **tidy**. The path does not resolve.
- A test that duplicates three others → **cull**. That is a judgment.
- A doc naming a command that no longer runs → **tidy**. The command exits non-zero.
- A doc describing a design the code outgrew → **cull**, or `/aleph:docs-writing`.

## Tracked and untracked

Establish this before you delete anything, because it sets what you may do alone.

A tracked file is recoverable: `git rm` it and the content stays in history. An untracked file is not. It has never been committed, so deleting it destroys the only copy.

**Delete tracked findings once the check passes. List untracked findings and get explicit confirmation, every run.** An untracked file is often exactly the scratch this skill hunts, and it is also the uncommitted work someone left open.

## Process

### 1. Baseline

`git status --porcelain` and the repo's build and test commands, read from the manifest. Record which findings are tracked. A dirty tree is fine, and it is also the reason the untracked rule exists: today's edits look like scratch.

### 2. Sweep

| Category | How to find it | The check |
|---|---|---|
| Build output and caches | Directories named in the build config's output path; `coverage/`, `.cache/`, `*.tsbuildinfo`, `__pycache__`, `target/`, `dist/` | The build regenerates it |
| Scratch and one-off output | `*.log`, `*.tmp`, `*.bak`, `*.orig`, `.DS_Store`, dated or numbered filenames, `test2.ts`, `foo-copy.py` | No reference anywhere in the tree, and no manifest or CI entry |
| Ignore-rule gaps | A **tracked** file matching a build-output or machine-local shape; `git check-ignore -v` disagreeing with reality | The file rebuilds, or it is local to one machine |
| Orphaned fixtures and tests | For each test and fixture, resolve the subject it names | The subject path is absent from the tree and from `HEAD` |
| Stale doc references | Every path, command and flag a doc names | The path resolves; the command runs; the flag appears in `--help` |
| Misplaced files | A file whose kind disagrees with its directory | The repo's own convention: the majority of that kind live elsewhere |

Two of these need a stated threshold rather than a guess. For **misplaced files**, the convention is the majority: if eleven hooks live in `hooks/` and one lives in `bin/`, the one is misplaced; a two-versus-three split is not a convention and not a finding. For **stale doc references**, resolve the reference, do not read around it: a command that runs is current even when the prose around it reads dated.

### 3. Sort

Three buckets, and say which each finding is in:

- **Remove** — the check passed.
- **Relocate** — the file is live, the directory is wrong.
- **Hand off** — needed a judgment. Name the skill it goes to and stop working it.

Present untracked removals as their own list, and ask before any of them go.

### 4. Apply

`git rm` for tracked removals, `git mv` for relocations so history follows the file, plain `rm` for untracked ones once confirmed. Fix the imports and config entries a relocation breaks, in the same commit as the move.

Add the ignore rule alongside the deletion whenever the file will come back: an artifact removed without its rule returns on the next build.

### 5. Verify

Build, test, and `git status`. A relocation that breaks a path shows up here, and it is the one category in this skill that can.

### 6. Report

Publish the sweep as an artifact. Load the `artifact-design` skill, write the
page, publish it with the Artifact tool, and give the user the link.

One row per finding: the path, its category, the check that decided it, and what
happened to it. Group the rows by outcome rather than by category. The reader
wants to know what changed; the category is how you found the file, not what you
did to it.

Three things belong on the page besides the rows:

- **Ignore rules added**, so a reader can tell why the next run will be quieter.
- **Hand-offs to `/aleph:cull`**, named as hand-offs. They are the work this
  skill deliberately refused, and an unexplained gap reads as an oversight.
- **Untracked files the user declined.** They survive into the next run, and the
  page is what keeps that from being a surprise.
