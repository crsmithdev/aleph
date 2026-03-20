---
name: docs-review
description: Detects drift between documentation and actual code/file state. Checks that every factual claim in docs is true.
---

# Documentation Sync

Docs that don't match behavior are worse than no docs — they actively mislead.

## Inputs

- List of documents to check (or use project extension to define scope)

## Process

### 1 — Enumerate claims

Read each document in scope. Extract every factual claim:
- "File X exists at path Y"
- "Hook/command Z is registered under event W"
- "Running command C produces output O"
- "Component A depends on B"

### 2 — Verify each claim

For each claim, check the truth source:
- File existence → check disk
- Registration claims → read config files
- Behavior claims → run the command, check output
- Directory layout → compare actual tree to documented tree

### 3 — Report

For each claim:
- `✓` — matches reality
- `✗` — contradicts reality (with evidence)
- `⚠` — ambiguous or untestable

## Output

Table: document, line, claim, actual state, suggested direction (update doc or update code).

## Done when

- Every document in scope read and claims extracted
- Every claim verified against its truth source
- Report produced with evidence for each finding
- No unverified claims remain

## Principles

- Code and tests are truth; docs are claims about truth
- Check every claim, not just ones that look suspicious
- When doc and code disagree, flag both options — don't assume which is correct
