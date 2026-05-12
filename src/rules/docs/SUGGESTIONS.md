# Suggested Rule Additions — Not Yet Enforced

Rule additions to consider for the docs trio. **None of these are enforced by
`RULES.md` until the user approves and migrates them.** This file exists so
the initial pilot is purely reorganizational (lifted-only rules) while
worthwhile additions are captured for review.

When the user approves an item, move its content into the appropriate section
of `RULES.md` and delete it from this file.

## 1. AI-tell ban list (proposed)

Currently implied by `STYLE.md`'s "no filler" rule but not enumerated. Explicit
ban list:

- "delve into"
- "dive into"
- "in conclusion"
- "I hope this helps"
- "it's worth noting"
- "comprehensive"
- "powerful"
- "seamless"
- "robust"
- "leverage"
- "utilize"

**Why suggest:** these phrases are the strongest LLM-output tells. STYLE.md
catches some via "no filler" but a literal banlist is easier to enforce
silently and easier to audit deterministically.

## 2. Doc-type templates

Canonical shapes for each doc type, currently each evolved ad-hoc in the
codebase:

- **README.md** — Title / Purpose / Quick start / Layout / Verification / Links
- **INSTALL.md** — Prerequisites / Steps / Verification / Rollback
- **AGENTS.md** — Role / When to invoke / Process / Output format / Cross-refs
- **SKILL.md** — Frontmatter / Mode of operation / Process / Output format
- **Module README.md** — Purpose / Files / Cross-refs

**Why suggest:** templates would live in
`docs-author-v2/references/structure-templates.md` and be referenced from
RULES.md section D. Currently each module/skill author improvises, so module
READMEs drift in shape — `docs-conform` could enforce alignment but only if
there's a canonical shape to align to.

## 3. Examples-over-prose

If a behavior fits a code block or table, prefer that over prose explanation.

**Why suggest:** STYLE.md says "tables over paragraphs; code over explanation"
which captures this, but doesn't explicitly require it for behavioral
documentation. A stronger rule would mandate it: "if you're explaining what
something does and a 5-line code example or 3-row table would convey the same
thing, the prose is wrong."

## 4. Frontmatter discipline

For all docs that use YAML frontmatter:
- Required keys present per doc type
- YAML quoting consistency (always quote string values, or never — pick one per file)
- No trailing whitespace inside frontmatter blocks

**Why suggest:** SKILL.md frontmatter and other YAML metadata across the repo
already drift in quoting style and key presence. A linter rule would catch
this; an explicit RULES.md entry would let `docs-audit` flag it.

## 5. Heading hierarchy enforcement

Never skip levels (no H1 → H3 jumps). Heading levels reflect document
structure; skipping breaks accessibility tooling and TOC generation.

**Why suggest:** RULES.md section B says "heading depth ≤ 3" but doesn't
forbid skipping. This makes the rule complete.

## 6. Stale-marker prohibition

Strengthen RULES.md section E: never include any phrase that signals
incomplete work in shipped docs:
- "TODO" / "TODO:" / "FIXME"
- "Coming soon"
- "(WIP)"
- "Last updated: <date older than 6 months>" without a refresh check

**Why suggest:** existing rule says "don't include 'TODO' or 'this section
will be filled in' — finish or omit." Broadening the list makes the rule
unambiguous in audit output.
