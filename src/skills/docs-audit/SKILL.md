---
name: docs-audit
description: >
  Post-hoc review of existing documentation against the canonical rule set in
  docs-author-v2/RULES.md. AUDIT MODE: identifies violations, doc-vs-code
  drift, and structural issues; emits a phased plan (Critical / Refinement /
  Polish). On peer drift, invokes docs-conform. On c7score-style issues,
  invokes docs-optimize. Does not write changes without approval.
metadata:
  argument-hint: <doc-or-doc-family>
---

# Docs Audit

Post-hoc companion to `docs-author-v2`. Reads the same rule set; produces
findings instead of suppressing them at write-time.

## Mode of operation

**AUDIT (only mode).** Walk the doc(s) in scope, check against every rule in
`../docs-author-v2/RULES.md`, run drift checks, and emit a phased plan. Do
not write any fix without the user's explicit approval per finding.

Canonical rules: `../docs-author-v2/RULES.md`. This skill does not duplicate
them — every finding cites the rule by section + file:line.

## Process

### 0. Establish scope

Identify exactly which docs are under audit:

```bash
# Single doc
git diff --name-only HEAD~1 -- '*.md'    # changed in last commit
# Doc family
ls src/skills/*/SKILL.md                  # all skill SKILL.md files
ls src/**/README.md                       # all module READMEs
```

Pre-existing issues outside the audit scope go in a "Pre-existing Issues"
section — don't mix them with findings about the change.

### 1. Voice & style check

Against `RULES.md` section A. Flag:
- AI-tell phrases ("Sure!", "That's a great question!", restating the question)
- Filler ("just", "really", "very", "basically")
- Passive voice in user-facing prose
- Sentences that could be removed without losing information

### 2. Formatting check

Against `RULES.md` section B. Flag:
- Code blocks without language tags
- More than one H1 per file
- Heading depth > 3
- Emoji
- Tables that should be paragraphs (or vice versa)
- File references not using `path/to/file:line` format

### 3. Density check

Against `RULES.md` section C. Flag:
- Lead-buried answers (the conclusion is in paragraph 4 instead of paragraph 1)
- "In this section we will…" / "It's worth noting…" openers
- Empty or stub sections ("this will be filled in")
- Long sentences that fit two short ones

### 4. Structure & metadata check

Against `RULES.md` section D. Flag:
- Missing TOC on docs > ~100 lines
- Missing version / last-updated where relevant
- Doc-type-specific issues (API docs missing schemas; config docs missing defaults)

### 5. Accuracy / drift check

Against `RULES.md` section E. **This is the highest-priority audit dimension** —
flag as Critical:
- References to functions, files, or flags that don't exist
- Behavioral claims that contradict actual code
- Code examples that don't run
- Cross-references that 404
- Stale stub markers (TODO, FIXME, "Coming soon")

For repo-specific drift checks, use the truth-source table in `RULES.md`
section E ("Doc-vs-code drift truth sources").

### 6. LLM-optimization check

Invoke `Skill('docs-optimize')` to run c7score-style analysis on the doc(s)
in scope. Capture findings about:
- Question coverage (snippets answering "How do I X?")
- Self-contained example completeness
- Metadata snippet pollution
- Import-only / install-only fragments

The c7score methodology lives in `docs-optimize/REFERENCE.md` and
`docs-optimize/references/c7score_metrics.md`.

### 7. Drift between peer docs

Compare docs in scope against other docs in their family (sibling SKILL.md
files, sibling module READMEs, etc.). Flag:
- Structural divergence (this README has Verification section; peers don't)
- Voice divergence (this guide is terse; peers are verbose)
- Frontmatter divergence (some have `argument-hint`; others don't)

When drift findings appear, invoke `Skill('docs-conform')` with the
canonical reference + drifted peers, rather than emitting a manual fix item.

### 8. Compile the phased plan

Group findings into three phases:

- **Phase 1 — Critical:** drift, false claims, broken cross-refs, missing required content
- **Phase 2 — Refinement:** structure, density, formatting, missing TOC
- **Phase 3 — Polish:** voice, AI tells, c7score finetune, microcopy

Each finding includes: the rule violated (RULES.md section + filename), the
location (`file:line`), the proposed fix, and a confidence rating.

### 9. Wait for approval

Present the plan. Do not implement anything. The user may reorder, cut, or
modify any recommendation. Execute only what's approved, surgically. After
each phase: present results for review before moving to the next.

## Output format

```
# Docs Audit: <scope>
Last Updated: YYYY-MM-DD

## Executive Summary
<1–2 sentences on current state>

## Scope
<files audited>

---

## PHASE 1 — Critical
[finding] — RULES.md §<X> / <file:line> — Confidence: High/Medium/Low
  Fix: <concrete change>

## PHASE 2 — Refinement
[finding] — RULES.md §<X> / <file:line>
  Fix: <concrete change>

## PHASE 3 — Polish
[finding] — RULES.md §<X> / <file:line>
  Fix: <concrete change>

---

## Pre-existing Issues (out of scope)
<findings outside the audit window>

## Drift findings — invoking docs-conform
<files where peer drift detected; reference + peer list passed to docs-conform>

## C7Score findings — invoking docs-optimize
<snippets / sections flagged; analysis report from docs-optimize>

## Next Steps
<approval gate>
```

Default save path:
`./dev/active/[task-name]/[task-name]-docs-audit.md`

## Done when

- All audited docs covered with specific, actionable findings
- Every finding cites a RULES.md section + file:line
- Drift findings routed to `docs-conform`; c7score findings routed to `docs-optimize`
- Plan saved to file
- Parent process informed: "Docs audit saved to: [path]"

**Do NOT implement fixes automatically.** Always end with: "Please review the
findings and approve which changes to implement before I proceed."
