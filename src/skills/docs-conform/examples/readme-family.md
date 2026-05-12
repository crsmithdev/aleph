# Worked Example — Aligning Module READMEs

This example walks through using `docs-conform` to align the construct-repo's
module-level README files to a canonical shape.

## Setup

The construct repo has multiple modules, each with its own README:

```
src/skills/README.md         # canonical reference (well-shaped)
src/skills/agent-browser/    # no README
src/skills/code-debug/       # has its own README, but different shape
...
```

Goal: all module READMEs follow the same structure as `src/skills/README.md`.

## Invocation

User says:
> Make all the skill module READMEs match `src/skills/README.md`

`docs-conform` triggers (keyword `"match the readme"` matches).

## Step 1: Resolve the reference

`docs-conform` reads `src/skills/README.md`. The pattern it identifies:

- H1 = module name
- Section order: Purpose → Files (table) → Cross-references
- Code blocks always fenced with `bash` for shell, `text` for tree output
- Cross-references at the bottom, not interleaved

## Step 2: Identify dimensions

The user didn't specify dimensions. Default is all five. The reference's
distinctive features:

- **Structure**: H1 = filename of parent dir; one H2 per major section
- **Composition**: Purpose / Files / Cross-references — exactly those three
- **State coverage**: not applicable for a static module README (no async behavior)
- **Tokens**: consistent use of "skill" (not "command" or "agent")
- **Microcopy**: imperative voice ("Run X") not gerund ("Running X")

## Step 3: Find peers

`docs-conform` runs:

```bash
find src/skills -maxdepth 2 -name README.md
```

Returns 8 module READMEs. Presents the list:

> Found 8 peers:
> - src/skills/code-debug/README.md
> - src/skills/code-conform/README.md
> - src/skills/design-audit/README.md
> - src/skills/design-conform/README.md
> - src/skills/docs-author/README.md
> - src/skills/docs-optimize/README.md
> - src/skills/skill-creator/README.md
> - src/skills/test-webapp/README.md
>
> Trim or proceed?

User: "proceed".

## Step 4: Compare and report

`docs-conform` diffs each peer against the reference:

| Peer | Drift |
|---|---|
| `code-debug/README.md` | **Major**: missing Files section |
| `code-conform/README.md` | **Aligned** |
| `design-audit/README.md` | **Minor**: H1 uses "Design Audit Skill" instead of "design-audit" |
| `design-conform/README.md` | **Minor**: Cross-references section is at the top, not bottom |
| `docs-author/README.md` | **Major**: no README (skill has only SKILL.md) — not applicable, skip |
| `docs-optimize/README.md` | **Major**: uses "## About" instead of "## Purpose" |
| `skill-creator/README.md` | **Stylistic**: uses gerund voice ("Creating skills") instead of imperative |
| `test-webapp/README.md` | **Aligned** |

Plus reference-as-outlier check:
> Note: 5 of 7 peer READMEs follow the reference's structure. The 2 that
> don't are the most recently added — reference is canonical.

## Step 5: Apply fixes (after approval)

User approves Phase 1 (Major drift only). `docs-conform` produces:

- `code-debug/README.md`: add Files section between Purpose and Cross-references
- `docs-optimize/README.md`: rename `## About` → `## Purpose`

User approves Phase 2 (Minor + Stylistic). `docs-conform` produces:

- `design-audit/README.md`: change H1 from "Design Audit Skill" to "design-audit"
- `design-conform/README.md`: move Cross-references section to the bottom
- `skill-creator/README.md`: rewrite gerund constructions to imperative

## Step 6: Verify

`docs-conform` runs the gate checks from `references/verification.md`:

- Markdown parses ✓
- Cross-references resolve ✓
- `bun test.ts` ✓
- Frontmatter parses (n/a — module READMEs don't have frontmatter)

Eyeball pass: side-by-side comparison of each conformed peer with the
reference. All five align.

## Step 7: Summary

> Aligned 5 module READMEs to `src/skills/README.md`'s structure.
> Skipped 1 (`docs-author/` has no README, only SKILL.md — not applicable).
> 2 were already aligned.
>
> Major: code-debug (added Files section), docs-optimize (renamed Purpose)
> Minor: design-audit (H1), design-conform (section order)
> Stylistic: skill-creator (voice)
>
> Reference-as-outlier check: reference confirmed canonical (5/7 peers
> already followed it before fixes).
>
> User should still review by eye:
> - `skill-creator/README.md` voice rewrites — imperative may need
>   per-sentence judgment in 3 places where the gerund was load-bearing.

## Cross-references

- Rules used: `src/rules/docs/RULES.md`
- Dimension taxonomy: `../references/dimensions.md`
- Gates: `../references/verification.md`
