# Skills Rules

Authoritative rules for SKILL.md files under `src/skills/`. Read by:

- `src/skills/skills-audit/SKILL.md` — flags violations in existing skills (post-hoc)
- `src/skills/skill-creator/SKILL.md` — applies these rules at write-time when authoring new skills
- CLAUDE.md (project-local + global) — applies silently at write-time

Every rule is **checkable**: it can be evaluated against a real SKILL.md file and produce a SARIF finding (per `src/skills/_shared/finding.md`). agnix already covers structural lint (CC-SK-* rule family) — this file covers semantic rules agnix doesn't.

Scope: every `src/skills/<name>/SKILL.md` plus their `references/`, `examples/`, and shared `_shared/` files. Also covers `src/skills/skill-rules.json` (the trigger registry).

---

## A. Frontmatter

*Sources: `docs/plans/skill-architecture.md` §3 (leaf contract), agnix CC-SK-* rules.*

### A.1 Required fields present

Every SKILL.md frontmatter must include `name:` and `description:`. Audit/fix leaves additionally need `verb:`, `domain:`, `modes:`.

- **Detect:** parse YAML frontmatter; flag missing `name` or `description` (always required); flag missing `verb`/`domain`/`modes` for files under `src/skills/<x>-audit/` or `<x>-fix/`
- **Severity:** `important`
- **Tag:** `frontmatter`

### A.2 `name:` matches the directory

The `name:` field must equal the parent directory name.

- **Detect:** for each `src/skills/<dir>/SKILL.md`, parse frontmatter and confirm `name == <dir>`
- **Severity:** `important`
- **Tag:** `naming`

### A.3 `verb:` is one of audit / fix / suggest / author

The architecture matrix recognizes four verbs (`docs/plans/skill-architecture.md` §1). Other values are undefined.

- **Detect:** `verb:` values outside `{audit, fix, suggest, author}`
- **Severity:** `important`
- **Tag:** `correctness`

### A.4 `domain:` is one of code / design / docs / skills / hooks / agents / config / security

The architecture matrix recognizes eight domains. Other values are undefined.

- **Detect:** `domain:` values outside the eight-domain set
- **Severity:** `important`
- **Tag:** `correctness`

---

## B. Description quality

*Sources: Claude Code skill-discovery behavior; the description is what the model reads to decide whether to trigger.*

### B.1 Description mentions concrete triggering phrases

A description like "use when needed" routes nothing. The description must say *what phrases* should trigger the skill so the keyword router and the model both have something to match.

- **Detect:** descriptions shorter than 100 characters; descriptions with no quoted phrases or `/<slash-command>` references
- **Severity:** `important`
- **Tag:** `description-quality`

### B.2 Description covers "When NOT to use" implicitly

The description should make scope clear so adjacent skills aren't ambiguous (e.g., `design-audit` vs `design-fix` vs `code-audit`).

- **Detect:** heuristic — description without negative framing AND with overlap with a sibling skill's description (parser-driven keyword overlap check)
- **Severity:** `nit`
- **Tag:** `description-quality`

---

## C. Registry consistency

*Sources: `src/skills/skill-rules.json`, agnix CC-SK-* rules. Mirrors `config/RULES.md` §C; this file is the canonical view from the skills domain.*

### C.1 Every SKILL.md has a `skill-rules.json` entry

A SKILL.md without a registry entry loads but only triggers via explicit `/<name>` or omnibus dispatch. For omnibus-only leaves (`-audit` / `-fix`) that's acceptable; for user-facing skills it's a discoverability bug.

- **Detect:** for each `src/skills/<name>/SKILL.md`, confirm `skill-rules.json` has an entry for `<name>` — except when frontmatter declares `omnibus-only: true` or the skill is in the audit/fix matrix
- **Severity:** `nit`
- **Tag:** `orphaned-skill`

### C.2 No duplicate keywords across registry entries

Literal keywords in `skill-rules.json` `keywords` arrays must not appear in two entries — first match wins, which is nondeterministic across file edits. Regex keywords are allowed to overlap deliberately.

- **Detect:** parse all `keywords:` arrays; flag any literal keyword appearing in two or more entries
- **Severity:** `important`
- **Tag:** `routing-collision`

---

## D. Progressive disclosure

*Sources: `docs/plans/skill-architecture.md` §3 ("~30-80 lines per SKILL.md, with detail in reference files that load on demand").*

### D.1 SKILL.md stays slim; detail in `references/`

A SKILL.md much longer than ~200 lines suggests detail that should be in a `references/<topic>.md` file (loaded on demand).

- **Detect:** SKILL.md files longer than 250 lines
- **Severity:** `nit`
- **Tag:** `slop`

### D.2 At least one `examples/` worked invocation

Skills with non-obvious invocation forms should have at least one `examples/<case>.md` showing reference → peers → diff → verification (or the domain-equivalent flow).

- **Detect:** `src/skills/<name>/` directories with no `examples/` subdirectory, for skills whose description mentions a slash-command or non-trivial invocation form
- **Severity:** `nit`
- **Tag:** `examples`

---

## E. Purity (R1)

*Sources: `docs/plans/skill-architecture.md` R1 — "Only the omnibus invokes `Skill()`".*

### E.1 Leaf skills don't call `Skill()`

Only `src/skills/omnibus/SKILL.md` may invoke other skills via `Skill(...)`. Every other skill is pure.

- **Detect:** `Skill(` calls in any SKILL.md outside the omnibus (prose mentions of `Skill()` in negative form are not violations — e.g., "no `Skill()` calls")
- **Severity:** `important`
- **Tag:** `r1-violation`

### E.2 Shared logic lives in files, not skill invocations (R2)

If two skills share process detail (e.g., "verification workflow"), the detail goes in a shared reference file consumed by both — not in one skill that the other invokes.

- **Detect:** SKILL.md files referencing another skill's `references/<file>.md` directly is fine; flag only when a skill describes "invoke `<sibling-skill>` to do X" outside of explicit omnibus-dispatch language
- **Severity:** `nit`
- **Tag:** `r2-violation`

---

## F. Gate discipline (R4)

*Sources: `docs/plans/skill-architecture.md` R4, `VERIFICATION.md`.*

### F.1 Skills call `gate("<domain>")`, not hardcoded commands

Fix-flavor skills must call `gate("<domain>")` for verification — never bake `bun test.ts` or similar into the skill text. The gate resolution lives in `VERIFICATION.md` / `omnibus.yml`.

- **Detect:** fix-flavor SKILL.md files containing literal `bun test.ts` / `bun run ui:smoke` / `agnix --dry-run` references outside a "Cross-references" block or example output
- **Severity:** `important`
- **Tag:** `r4-violation`

---

## G. Trigger-description alignment

*Sources: practical observation — keyword-rule descriptions drift from reality after refactors.*

### G.1 Keywords in `skill-rules.json` cover the phrases the description promises

If a SKILL.md's description says "triggers on 'audit the design'", the `skill-rules.json` entry should include `"audit the design"` or a regex that matches it.

- **Detect:** parse the SKILL.md description, extract quoted trigger phrases, then confirm each appears (literally or via regex) in the corresponding `skill-rules.json` entry
- **Severity:** `nit`
- **Tag:** `trigger-drift`

---

## Negative-filter list (uniform with other audit leaves)

Per `src/skills/_shared/finding.md`:

- Style preferences not in this file → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues" SARIF run
- Issues agnix already covers (CC-SK-* family) → cite agnix's rule and pass through
- Pedantic nitpicks → drop
- Lint-ignored lines → drop

---

## Approval policy

Skill findings default to `approval: single` per `omnibus.yml` `by_domain.skills`. Most are fix-with-edit findings (frontmatter additions, registry entries, keyword adjustments) — single approval is fine.
