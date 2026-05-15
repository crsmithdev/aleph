---
name: skills-audit
description: >
  Audit SKILL.md files under `src/skills/` against `src/rules/skills/RULES.md`
  — frontmatter completeness, description quality, registry consistency,
  progressive disclosure, purity (R1 — no `Skill()` calls from leaves), gate
  discipline (R4 — no hardcoded `bun test.ts`), trigger-description
  alignment. Emits SARIF findings (per `src/skills/_shared/finding.md`) plus
  a phased prose report. Read-only — no edits. Triggers on "audit skills",
  "check my skills", "audit the skill registry", "find orphaned skills",
  "/skills-audit", "/audit skills", or when the omnibus dispatches the
  audit verb to the skills domain. agnix CC-SK-* covers structural lint;
  this skill adds the semantic layer.
verb: audit
domain: skills
modes: [report]
metadata:
  argument-hint: <skill-name-or-dir>
---

# Skills Audit

Walks SKILL.md files in scope, evaluates each rule in `src/rules/skills/RULES.md`, and emits SARIF findings. Runs `agnix` first to collect CC-SK-* / XP-* structural lint, then adds the semantic layer: description quality, registry consistency, R1/R2/R4 architecture rule compliance, and trigger-description alignment.

Pure leaf: no `Skill()` calls. The omnibus chains us; we report.

## When to use

- User asks to audit their skill registry, find orphaned skills, or check skill quality.
- User invokes `/skills-audit`, or the omnibus dispatches the `audit` verb to the `skills` domain.

## When NOT to use

- Full agent-config health check → `config-audit`.
- Only hook-script issues → `hooks-audit`.
- Authoring a new skill → `skill-creator`.

## Inputs

1. **Scope** (default: `--all`) — all SKILL.md files in `src/skills/`. `--diff` for changed-only; `--module <path>` for a single skill.
2. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

## Process

### 1. Run agnix structural lint

Before the semantic walk, run agnix against the skills directory to collect structural findings. agnix covers rule families CC-SK-* (Claude Code skill rules) and XP-* (cross-platform):

```bash
agnix --target claude-code --format sarif src/skills/ 2>&1
```

Collect all errors and warnings. Mark fixable ones `[fixable]`. Pass them through in the SARIF output citing `agnix/CC-SK-<n>` / `agnix/XP-<n>` rule IDs — don't re-report them under your own ruleIds.

### 2. Resolve scope

```bash
# --diff (against origin/main)
git diff --name-only origin/main...HEAD -- 'src/skills/**/SKILL.md' 'src/skills/skill-rules.json'

# --module <path>
find <path> -name 'SKILL.md'

# --all (default — small, stable set)
find src/skills -name 'SKILL.md'
```

Also include `src/skills/skill-rules.json` in scope by default (registry consistency rules need it).

### 3. Walk the rules

For each in-scope SKILL.md, evaluate sections A through G in `src/rules/skills/RULES.md`. Concrete checks:

- **A.1-A.4 (frontmatter):** parse YAML, confirm `name` + `description` present; for audit/fix skills also `verb` / `domain` / `modes`; flag values outside the recognized verb / domain sets.
- **A.2 (name matches dir):** confirm `name == basename(dirname(path))`.
- **B.1-B.2 (description quality):** descriptions ≥100 chars; mentions concrete trigger phrases (quoted or `/<slash>`); covers scope vs sibling skills.
- **C.1 (orphaned):** for each SKILL.md, confirm `skill-rules.json` has an entry — unless the skill is an audit/fix leaf (omnibus dispatches those by name) or explicitly marked omnibus-only.
- **C.2 (duplicate keywords):** parse all `keywords` arrays; flag literal keywords appearing in 2+ entries.
- **D.1 (slim SKILL.md):** flag files longer than 250 lines (detail should move to `references/`).
- **D.2 (examples):** skills with slash-commands or non-trivial invocations should have at least one `examples/<case>.md`.
- **E.1 (R1 — no Skill() from leaves):** grep `Skill(` in every SKILL.md outside `omnibus/SKILL.md`; allow only prose negations (`"no \`Skill()\` calls"`); flag actual invocations.
- **E.2 (R2 — no inline skill chaining):** flag prose like "invoke `<sibling-skill>` to do X" outside omnibus-dispatch context.
- **F.1 (R4 — no hardcoded gates):** in fix-flavor SKILL.md files, flag literal `bun test.ts` / `bun run ui:smoke` / `agnix --dry-run` outside Cross-references / example blocks.
- **G.1 (trigger drift):** parse description, extract quoted trigger phrases, confirm each appears in the corresponding `skill-rules.json` entry's keyword list (literal or regex).

### 4. Apply negative-filter list

Per `src/rules/skills/RULES.md` + `src/skills/_shared/finding.md`:

- Style preferences not in `skills/RULES.md` → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues"
- Issues agnix CC-SK-* covers → cite agnix's rule, pass through
- Pedantic nitpicks → drop
- Lint-ignored lines → drop

### 5. Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "skills-audit"`. Each `result`:

```json
{
  "ruleId": "skills/RULES.md#<section>.<n>" | "agnix/CC-SK-<n>",
  "level": "error" | "warning" | "note",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "src/skills/<name>/SKILL.md" }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "praise",
    "fix": "<concrete change — frontmatter add, keyword add, refactor>",
    "tag": "frontmatter" | "naming" | "correctness" | "description-quality" | "orphaned-skill" | "routing-collision" | "slop" | "examples" | "r1-violation" | "r2-violation" | "r4-violation" | "trigger-drift",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

Praise candidates: SKILL.md files that exemplify the architecture leaf contract (slim, scoped, cite RULES.md, pure leaf, well-named, registry entry matches trigger phrases). Mark `severity: praise`, `tag: defense-in-depth`, with a `fix` like "use as reference for: leaf-skill structure".

### 6. Emit a phased prose summary

```
# Skills Audit — <scope>

## Summary
N skills audited · N orphaned · N missing examples · N over-length
Keyword collisions: N · R1 violations: N · R4 violations: N

## blocking (N)
- <file:line> — <rule> — <one-line>

## important (N)
- ...

## nit (N)
- ...

## Skill detail

| Skill | Frontmatter | Registry | Name match | Length | Examples | R1 | Verdict |
|-------|-------------|----------|------------|--------|----------|----|----|
| ... | ✓ | ✓ | ✓ | 178L | ✓ | ✓ | OK |

## Pre-existing issues (out of scope)
- ...
```

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or mutating `Bash`.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **No verification gate.** Audit is non-mutating.
- **Don't duplicate agnix.** Cite CC-SK-* rules where they apply.

## Output template

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Skills Audit — <scope>
<phased prose + detail tables>
```

## Guardrails

- **Confidence is provisional.** Omnibus validation refines it.
- **Cite rules precisely.** `skills/RULES.md#<section>.<n>` or `agnix/CC-SK-<n>`.
- **R1 violations are blocking-leaning.** A skill that chains `Skill()` from a leaf undermines the architecture; surface aggressively.
- **Trigger-drift is high-leverage.** A SKILL.md promising triggers the registry doesn't match means the skill never fires — the keyword router is the only routing layer.

## Cross-references

- Rule source: `src/rules/skills/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Architecture: `docs/plans/skill-architecture.md` (R1, R2, R4)
- Author counterpart: `src/skills/skill-creator/SKILL.md`
- Broader audit: `src/skills/config-audit/SKILL.md` (skills + hooks + CLAUDE.md + MCP + permissions in one pass)
- Orchestrator: `src/skills/omnibus/SKILL.md`
