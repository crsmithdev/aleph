---
name: docs-writing
description: >
  Writes technical docs with Diataxis type gating and runnable examples, and
  holds the doc rules refit-docs audits against. Use when the user asks to
  write or rewrite docs, an API reference, a how-to, or a README. NOT for:
  reviewing or auditing docs (use /aleph:refit-docs); AGENTS.md, CLAUDE.md or
  skills (use /aleph:writing-for-agents).
---

# Documentation Writing

- **IS:** writing technical documentation, and the rules for its quality (Diataxis doc types, voice, structure, clarity, runnable code, formatting, navigation, content hygiene, agent-readable docs) for docs sites, API references, documentation-site tutorials, how-to docs, and existing READMEs.
- **IS NOT:** editorial blog tutorials or articles, AGENTS.md or CLAUDE.md instructions (use `aleph:writing-for-agents`), marketing and landing-page copy, or the product's own error strings and CLI output (this skill covers the docs that describe them).

## Mode dispatch

- Writing or rewriting a page? → Writing workflow.
- Reviewing, auditing or improving docs? → [refit-docs](../refit-docs/SKILL.md). Its lenses load the rules here by
  prefix.

## Classify before anything else

Doc type gates which rules apply, so classify every file first. Use the Diataxis compass: does the page serve **action** (doing) or **cognition** (understanding), and is the reader **acquiring** a skill or **applying** one?

`structure-diataxis` holds the compass table and the split for a mixed page. Classify by the reader's task, not the filename. A README can orient or reference; a getting-started page can be a tutorial or a goal-directed how-to.

## Writing workflow

Track this checklist:

```text
Docs writing progress:
- [ ] Step 1: Pick one Diataxis type per file with the compass; name the audience and what they can do afterwards
- [ ] Step 2: Read the defaults bundles (voice-defaults, clarity-defaults, scan-defaults) plus the structure- and code- rules the type-gating table keeps
- [ ] Step 3: Draft: bottom line up front, quick start for getting-started docs, runnable example per concept, next steps for tutorials and how-tos
- [ ] Step 4: Apply the type-relevant rules to concrete weaknesses in the draft
- [ ] Step 5: Verify with `review-defaults` and `review-verify-links`; quote the command output
```

For a README, start from `readme-template.md`.

## Type-gating table

These rules apply only to the listed types.

| Rule | Applies to |
|------|-----------|
| `structure-quick-start` | Getting-started pages, READMEs |
| `structure-next-steps`, `structure-procedures` | Tutorials, how-to guides |
| `code-multiple-languages` | Reference and how-to pages for a multi-SDK API |
| `scan-three-column-api` | API reference |
| `hygiene-experimental-label`, `hygiene-planned-label` | Reference and how-to pages for unstable or unshipped features |
| `nav-agent-readable` | Docs sites (not a single README) |

Everything else applies to every type. Tutorials additionally get the `we` allowance in `voice-defaults`; reference pages get the signature-block allowance in `structure-heading-overview`.

## Rule categories by priority

| Priority | Category | Impact | Prefix | Rules |
|----------|----------|--------|--------|-------|
| 1 | Voice & Tone | CRITICAL | `voice-` | 4 |
| 2 | Structure & Organization | CRITICAL | `structure-` | 9 |
| 3 | Clarity & Language | HIGH | `clarity-` | 5 |
| 4 | Code Examples | HIGH | `code-` | 8 |
| 5 | Formatting & Syntax | MEDIUM-HIGH | `format-` | 7 |
| 6 | Navigation & Linking | MEDIUM-HIGH | `nav-` | 7 |
| 7 | Scanability & Readability | MEDIUM | `scan-` | 2 |
| 8 | Content Hygiene | MEDIUM | `hygiene-` | 6 |
| 9 | Review & Testing | LOW-MEDIUM | `review-` | 3 |

For the full rule list per category, read `rules/_sections.md`. The `*-defaults.md` files (voice, clarity, scan, review) are multi-check bundles.

## Gotchas

- Doc-type misclassification is the top false-positive source. A missing quick start on an explanation page, or a "Next steps" section demanded of a reference page, is a finding against Diataxis, not for it.
- Cite the specific failing check in a `*-defaults.md` bundle ("`voice-defaults`: passive voice"), not just the filename, or the author can't locate the issue.
- Rule files carry their own false-positive guidance (the "should" check, sample credentials, hand-typed dates, series openers). Read the rule before you flag a finding against it.

Adapted from Matthew Blode's `docs-writing` skill (github.com/mblode/agent-skills, MIT, `skills/docs-writing/LICENSE`), with its references to sibling skills and its eval suite removed.
