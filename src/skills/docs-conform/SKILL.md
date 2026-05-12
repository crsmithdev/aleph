---
name: docs-conform
description: >
  Reference-based propagation across peer docs — take one doc the user has
  pointed at as the reference, find peer docs that should match it, and align
  them. Often invoked from docs-audit on drift findings; can be called
  directly when the user notices structural divergence between READMEs,
  AGENTS.md files, SKILL.md frontmatter, or similar doc families. Validates
  against src/rules/docs/RULES.md.
metadata:
  argument-hint: <reference-doc> [peer-scope]
---

# Docs Conform

Take a doc reference (a README, AGENTS.md, SKILL.md, guide), find peer docs
that should look like it, and align them. Ad-hoc — no registry, no template
file. The reference *is* the spec.

Canonical rules (used to validate alignment): `src/rules/docs/RULES.md`.

## When to use

- User points at a polished doc and asks to align peer docs.
- User notices structural drift between similar doc surfaces (module READMEs,
  skill SKILL.md files, AGENTS.md files).
- User finishes refining one doc and wants the family to match.
- `docs-audit` detected peer drift and invoked this skill.
- User invokes `/docs-conform`.

## When NOT to use

- Voice / tone fix on a single doc with no peers — edit directly.
- Doc-vs-code drift (claim contradicts code) — that's `docs-audit`.
- Pure LLM-readability optimization (c7score, llms.txt) — that's `docs-optimize`.
- Net-new doc creation — that's `docs-author-v2`.

## Inputs

1. **Reference** (required) — file path or section. The doc the user
   considers canonical for the family.
2. **Scope** (optional) — glob, directory, or file list. Defaults to
   auto-detected peers (see step 3).
3. **Notes** (optional) — which dimensions to focus on or ignore. Free-form
   trailing text.
4. **Mode flags** (optional) — `--report` for audit-only (no fixes),
   `--all` to include legacy docs (default: diff-only current session).

## Process

### Step 1: Resolve the reference

Read the reference doc. If the user pointed at a section or recent edit,
locate the exact lines. If ambiguous, ask.

### Step 2: Identify what's distinctive

Extract the *pattern*, not the whole doc. Five dimensions (deep reference in
`references/dimensions.md`):

- **Structure** — heading shape, frontmatter keys, section order
- **Composition** — sections present/absent (Quick Start? Verification? Hook table?)
- **State coverage** — does the doc handle "no CI", "no skills", "empty examples" sections cleanly, or does it just blank?
- **Tokens / terminology** — consistent use of project nouns
- **Microcopy** — voice, sentence shape, anti-patterns

If user gave notes ("only the heading shape"), narrow to that. Otherwise
default to *everything that looks like an intentional pattern*; skip
incidental differences (specific content, doc-specific data shapes).

### Step 3: Find peers

Auto-detect by:
1. Filename pattern — `*/README.md`, `*/SKILL.md`, `*/AGENTS.md`
2. Directory siblings — same parent directory
3. Doc-type families — all skill SKILL.md files; all module READMEs
4. Files Claude touched recently this session (diff-only mode)

User's explicit scope filters candidates.

**Always present peer list first.** "Found 7 peers: A, B, C, D, E, F, G.
Trim or proceed?"

### Step 4: Compare and report

Diff each peer against reference along the chosen dimensions. Validate
findings against `src/rules/docs/RULES.md`. Rank by severity:

- **Major** — pattern entirely missing (no Verification section in a peer
  README that should have one; missing required frontmatter key)
- **Minor** — pattern present but degraded (heading wording inconsistent;
  table column order differs)
- **Stylistic** — pattern matches but small surface differences
  (capitalization in headings; punctuation in labels)

### Step 5: Reference-as-outlier check

If the reference differs from the *majority* of peers, surface this:
"Note: 5 of 7 peers don't follow the reference's structure. Is the reference
the canonical, or did I pick the wrong anchor?" User confirms or flips anchor.

### Step 6: Apply fixes (after approval)

- Read peer file
- Compute minimal `Edit` operations to bring it in line with the reference
  for the chosen dimensions only
- Preserve doc-specific content, examples, and incidental wording
- Do NOT introduce new sections that the peer didn't already need
- Validate every change against `RULES.md` (e.g., new headings respect
  depth ≤ 3; new code blocks have language tags)

### Step 7: Summarize

One paragraph: which peers aligned, which skipped and why, what the user
should still review by eye.

## Default scope: diff-only

By default, only consider peers that:
- Were edited in the current session, OR
- Are explicitly named in the user's invocation, OR
- Were auto-detected and confirmed in step 3

Use `--all` to include every peer in the codebase.

## Verification

After fixes, gate on these checks before claiming done. Full reference in
`references/verification.md`.

- Markdown renders without syntax errors
- All cross-references resolve (no `[broken](missing.md)`)
- Frontmatter parses (YAML lints clean)
- All claims verifiable against the corresponding truth source (per
  `RULES.md` section E doc-vs-code drift table)

For module READMEs / SKILL.md files: `bun test.ts` should still pass — these
files are read by hooks and the install script.

## Guardrails

- **Never propose fixes without showing the peer list first.** User must be
  able to trim false positives before edits.
- **Never rewrite a doc wholesale** unless the user explicitly approves it.
  Minimal edits only.
- **Never enforce a dimension the user didn't ask for** when notes are present.
- **Never trigger on legacy docs in default mode.** Diff-only by default.
- **Surface intentional divergence.** If a peer has a comment or frontmatter
  flag indicating intentional difference, skip it and note in the report.
- **One reference, one pass.** Don't enforce multiple unrelated patterns in
  a single invocation — ask the user to run again with a different reference.
- **Removed content goes completely.** When you delete a section because the
  reference doesn't have it, also remove orphaned cross-refs to that section
  (commandment 7: remove completely).

## Output format

```
Reference: <path>[:section]
Pattern dimensions: <list, derived from reference + notes>
Peers considered: <count>
Drift: Major <n> / Minor <n> / Aligned <n>

[detailed list, grouped by peer]

Proposed edits: <count> across <count> files
[show diffs, gate on approval]

After fix: verification result + manually reviewed peers
```

## Worked example

See `examples/readme-family.md` for a walk-through of aligning the
construct-repo's module READMEs to a canonical shape.

## Cross-references

- Rules used to validate alignment: `src/rules/docs/RULES.md`
- Conform dimensions deep reference: `references/dimensions.md`
- Verification gates: `references/verification.md`
- Sibling skills: `docs-author-v2` (write-time), `docs-audit` (post-hoc review),
  `docs-optimize` (LLM-readability optimization)
