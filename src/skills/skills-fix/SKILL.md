---
name: skills-fix
description: >
  Apply fixes for skills-audit findings — add missing frontmatter fields,
  rename to match directory, fix description quality, add skill-rules.json
  entries, remove duplicate keywords, extract over-length SKILL.md detail
  into references/, add examples/ directories, fix R1 violations (remove
  Skill() calls from leaf skills), fix R4 violations (replace hardcoded
  `bun test.ts` with `gate("<domain>")`), align trigger phrases with
  registry. Takes SARIF findings from `skills-audit` as input. Verifies
  with `gate("skills")`. Triggers on "fix the skills findings",
  "remediate skill drift", "/skills-fix", "/fix skills", or when the
  omnibus dispatches the fix verb to the skills domain after approval.
verb: fix
domain: skills
modes: [fix]
---

# Skills Fix

Applies edits derived from `skills-audit` findings. Each finding's `properties.tag` routes to a fix shape; this skill executes the change minimally and verifies with `gate("skills")`.

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix.

## When to use

- After `skills-audit` produced findings and the user approved them.
- User invokes `/skills-fix` against a saved SARIF report, or `/fix skills` via the omnibus.

## When NOT to use

- Authoring net-new skills → `skill-creator`.
- Hook-script fixes → `hooks-fix`.
- Agent-definition fixes → `agents-fix`.
- General code fixes → `code-fix`.

## Inputs

1. **Findings** (required) — SARIF v2.1.0 from `skills-audit`.
2. **Approvals** — explicit approval per `omnibus.yml.by_domain.skills` (single by default).
3. **Scope** — inherited from findings.

## Process

### 1. Resolve findings

Parse SARIF; group by `properties.tag`.

### 2. Map tag → fix shape

| Tag | Fix shape | What it does |
|---|---|---|
| `frontmatter` | Field addition | Add missing `name` / `description` / `verb` / `domain` / `modes` to the SKILL.md frontmatter |
| `naming` | Rename | Rename the directory to match `name:`, OR update `name:` to match the directory (user-decided per finding) |
| `correctness` (verb/domain) | Value fix | Update `verb:` or `domain:` to one of the architecture-recognized values |
| `description-quality` | Rewrite | Apply the rewritten description from `properties.fix`; ensure ≥100 chars, concrete trigger phrases, scope vs siblings |
| `orphaned-skill` | Registry entry | Add a `skill-rules.json` entry for the skill with keywords derived from its description |
| `routing-collision` | Keyword disambiguation | Remove the duplicate keyword from the lower-priority entry; add a more specific keyword in its place |
| `slop` (length) | Extract to references | Move detail blocks to `references/<topic>.md`; SKILL.md keeps the cross-reference |
| `examples` | Add example | Create `examples/<case>.md` with a worked invocation (reference → peers → diff → verification) |
| `r1-violation` | Remove Skill() | Replace the inline `Skill('<x>')` invocation with a tagged-finding emission; let the omnibus route |
| `r2-violation` | Convert to reference | Replace "invoke `<sibling>`" prose with a file reference (e.g., `references/<shared-process>.md`) |
| `r4-violation` | Replace hardcoded gate | Replace `bun test.ts` / `bun run ui:smoke` / etc. with `gate("<domain>")` and verify `VERIFICATION.md` resolution exists |
| `trigger-drift` | Keyword sync | Add the trigger phrases promised by the description to the `skill-rules.json` entry's `keywords` array |

For findings without a clean tag mapping, treat `properties.fix` as the literal change.

### 3. Plan the edits

Compute the minimal `Edit` per finding. Group edits by file. Most fixes touch one SKILL.md plus `skill-rules.json`.

**Hard rules:**

- **Don't rename skills without explicit per-finding approval.** Naming fixes can break callers / registry entries downstream — confirm directionality.
- **Don't add registry entries for omnibus-only leaves** (`-audit` / `-fix`) unless the user explicitly requests keyword routing for them.
- **Removed code goes completely.** Per Commandment 7: no leftover trigger phrases, no orphan example files.
- **No scope creep.** Adjacent issues are new findings.

### 4. Show the plan

Output the planned edits. Frontmatter changes are tiny; registry edits are tiny; refactors (extraction to references) are larger and shown in full.

For omnibus-dispatched runs with approval, proceed to step 5. For direct invocation, wait.

### 5. Apply edits

Order:

1. **SKILL.md frontmatter edits** (atomic; minimal blast radius).
2. **Body edits** (R1/R2/R4 violation rewrites, voice fixes).
3. **`skill-rules.json` edits** (registry entries, keyword adjustments). Validate JSON after each edit.
4. **File / directory operations** (rename SKILL.md, extract detail to `references/`, add `examples/<case>.md`). Use `git mv` for renames.
5. **Cross-reference updates** (any other doc / agent / hook referencing the renamed skill).

### 6. Verify

Run `gate("skills")` from `VERIFICATION.md`. Per `omnibus.yml`, this resolves to `bun test src/skills` — confirms skill-related tests still pass after the changes.

Also inline:

- **JSON parses** — `bun -e 'JSON.parse(...)'` on `skill-rules.json`.
- **No new R1 violations** — re-grep `Skill(` in any touched SKILL.md (excluding omnibus); confirm only prose negations remain.
- **agnix --dry-run** (if installed) — confirm structural lint is green.

If any check fails, identify which fix caused it and revert or adjust.

### 7. Summarize

One paragraph: which findings were resolved, which SKILL.md / registry entries were touched.

## Output

```
[plan]
... edit list, grouped by file (SKILL.md, skill-rules.json, references/, examples/) ...
[/plan]

[applying]
... per-edit lines ...
[/applying]

[verify]
scope:      <files edited>
method:     gate("skills") (bun test src/skills) + JSON.parse(skill-rules.json) + grep Skill( + agnix --dry-run (if installed)
assertions: skill tests pass; registry is valid JSON; no leaf calls Skill(); agnix structural lint green
[/verify]

# Summary
- <N> findings resolved
- <M> SKILL.md files edited
- <P> skill-rules.json entries updated
- <K> findings skipped (with reasons)
```

## Guardrails

- **Verification is non-negotiable.** All four checks (skill tests + JSON valid + no Skill() in leaves + agnix green) must show in the turn's tool output.
- **Approved findings only.**
- **No scope creep.** Adjacent issues are new findings.
- **JSON edits validate immediately.** Never leave `skill-rules.json` in an invalid state between Edit calls.
- **Renames need explicit per-finding approval.** Surface the rename direction; let the user pick.
- **No `Skill()` calls.** The omnibus dispatches; we apply.

## Cross-references

- Rule source: `src/rules/skills/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Audit counterpart: `src/skills/skills-audit/SKILL.md`
- Author counterpart: `src/skills/skill-creator/SKILL.md`
- Architecture: `docs/plans/skill-architecture.md` (R1, R2, R4)
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
