# Skills Rules

Authoritative rules for SKILL.md files under `src/skills/`. Read by:

- `src/skills/skills-audit/SKILL.md` — flags violations in existing skills (post-hoc)
- `src/skills/skill-creator/SKILL.md` — applies these rules at write-time when authoring new skills
- CLAUDE.md (project-local + global) — applies silently at write-time

Every rule is **checkable**: it can be evaluated against a real SKILL.md file and produce a plain-markdown finding citing this file's section anchor. agnix already covers structural lint (CC-SK-* rule family) — this file covers semantic rules agnix doesn't.

Scope: every `src/skills/<name>/SKILL.md` plus their `references/`, `examples/`, and shared `_shared/` files. Also covers `src/skills/skill-rules.json` (the trigger registry).

---

## A. Frontmatter

*Sources: `docs/plans/skill-architecture.md` §3 (leaf contract), agnix CC-SK-* rules.*

### A.1 Required fields present

Every SKILL.md frontmatter must include `name:` and `description:`. Review leaves additionally need `verb:` and `domain:`.

- **Detect:** parse YAML frontmatter; flag missing `name` or `description` (always required); flag missing `verb`/`domain` for files under `src/skills/*-review/`
- **Severity:** `important`
- **Tag:** `frontmatter`

### A.2 `name:` matches the directory

The `name:` field must equal the parent directory name.

- **Detect:** for each `src/skills/<dir>/SKILL.md`, parse frontmatter and confirm `name == <dir>`
- **Severity:** `important`
- **Tag:** `naming`

### A.3 `verb:` is one of audit / author

Review leaves use `verb: audit`. Author leaves (skill-creator, etc.) use `verb: author`. Other values are undefined.

- **Detect:** `verb:` values outside `{audit, author}`
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

The description should make scope clear so adjacent skills aren't ambiguous (e.g., `design-review` vs `code-review`).

- **Detect:** heuristic — description without negative framing AND with overlap with a sibling skill's description (parser-driven keyword overlap check)
- **Severity:** `nit`
- **Tag:** `description-quality`

---

## C. Registry consistency

*Sources: `src/skills/skill-rules.json`, agnix CC-SK-* rules. Mirrors `config/RULES.md` §C; this file is the canonical view from the skills domain.*

### C.1 Every SKILL.md has a `skill-rules.json` entry

A SKILL.md without a registry entry loads but only triggers via explicit `/<name>` invocation. For user-facing skills that's a discoverability bug.

- **Detect:** for each `src/skills/<name>/SKILL.md`, confirm `skill-rules.json` has an entry for `<name>`
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

*Sources: skill architecture R1 — "Only the audit dispatcher invokes `Skill()`".*

### E.1 Leaf skills don't call `Skill()`

Only `src/skills/audit/SKILL.md` may invoke other skills via `Skill(...)`. Every other skill is pure.

- **Detect:** `Skill(` calls in any SKILL.md outside `src/skills/audit/` (prose mentions of `Skill()` in negative form are not violations — e.g., "no `Skill()` calls")
- **Severity:** `important`
- **Tag:** `r1-violation`

### E.2 Shared logic lives in files, not skill invocations (R2)

If two skills share process detail (e.g., "verification workflow"), the detail goes in a shared reference file consumed by both — not in one skill that the other invokes.

- **Detect:** SKILL.md files referencing another skill's `references/<file>.md` directly is fine; flag only when a skill describes "invoke `<sibling-skill>` to do X"
- **Severity:** `nit`
- **Tag:** `r2-violation`

---

## F. Gate discipline (R4)

*Sources: skill architecture R4, `VERIFICATION.md`.*

### F.1 Skills call `gate("<domain>")`, not hardcoded commands

Review leaves must call `gate("<domain>")` for verification — never bake `bun test.ts` or similar into the skill text. The gate resolution lives in `VERIFICATION.md`.

- **Detect:** review-flavor SKILL.md files containing literal `bun test.ts` / `bun run ui:smoke` / `agnix --dry-run` references outside a "Cross-references" block or example output
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

### G.2 Keywords match the user's actual phrasing from transcripts

Generic keywords ("review the code", "audit the design") trigger less reliably than keywords copied from how the user actually types. A rule whose keywords never appear in real prompts is a dead rule — even if it reads sensibly.

- **Detect:** extract user prompts from the last 14 days of transcripts at `~/.claude/projects/<project-slug>/*.jsonl` (filter to `type=="user"`, `message.role=="user"`, `message.content | type=="string"`, exclude tool results / hook output / session-continuation summaries). For each skill in `skill-rules.json`:
  - **Dead keyword:** a literal keyword that has zero substring matches across all extracted prompts. Flag with suggestion to remove or replace.
  - **Missing keyword:** a phrase that appears ≥3 times in the prompts AND is semantically aligned with the skill's domain AND does not match any existing keyword. Surface the phrase verbatim as a suggested addition.
  - **Cross-skill collision risk:** a candidate keyword that would also match another skill's domain — call out which two skills overlap so the user picks where it belongs.
- **Severity:** `suggestion`
- **Tag:** `trigger-realism`
- **Method note:** count distinct prompts, not character occurrences. Match case-insensitively. Skip prompts shorter than 5 chars (`yes`, `continue`, `ok`) — they carry no routing signal. Cite the prompt verbatim in the finding so the user sees the actual phrasing.

### G.3 Skills with zero invocations in the last 14 days

A skill registered in `skill-rules.json` that was never invoked in 14 days of sessions is either (a) genuinely rare, (b) shadowed by another skill's keywords, or (c) keyworded against phrases the user never types. Surface so the user can decide.

- **Detect:** for each rule in `skill-rules.json`, scan `~/.claude/projects/<project-slug>/*.jsonl` for `name:"Skill"` tool calls with `input.skill == <name>`. Zero hits in 14d → flag.
- **Severity:** `suggestion`
- **Tag:** `unused-trigger`
- **Method note:** distinguish "brand-new skill, < 7 days old" (not a finding — too young to judge) from "registered > 14 days ago, zero hits" (real finding). Use `git log --follow --diff-filter=A -- src/skills/<name>/SKILL.md` for creation date.

---

## H. Usage signals and cross-domain references

*Sources: git log; static reference analysis; practical observation — skills unused since creation or shadowed by keyword collisions are dead weight.*

### H.1 Skill has been exercised (git age + keyword realism)

A skill with no examples/, a sparse description, and no git activity in the last 30 days since creation is probably dead weight — never triggered, or triggered by accident and producing poor results. Not a hard rule, but a strong signal worth surfacing.

- **Detect:** skills where ALL of the following are true: (a) no `examples/` directory, (b) description < 150 chars, (c) `git log --since="30 days ago" -- src/skills/<name>/` returns 0 commits, (d) the skill is older than 30 days (`git log --follow --diff-filter=A` shows creation > 30 days ago)
- **Severity:** `suggestion`
- **Tag:** `unused-skill`

### H.2 Agent and hook references in skill body are live

If a skill's body mentions an agent by name (e.g., `subagent_type: "code-review"`) or a hook by script name, those must still exist.

- **Detect:** parse skill body for `subagent_type: "<name>"` patterns and any prose references to hook script names; grep `src/agents/`, `~/.claude/agents/`, and the hook registry to confirm; flag missing
- **Severity:** `important`
- **Tag:** `dead-reference`

---

## Negative-filter list (uniform with other review leaves)

- Style preferences not in this file → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues"
- Issues agnix already covers (CC-SK-* family) → cite agnix's rule and pass through
- Pedantic nitpicks → drop
- Lint-ignored lines → drop

---

## Approval policy

At the leaf's approval gate, skill findings default to apply-all / pick / discard. Most are mechanical edits (frontmatter additions, registry entries, keyword adjustments) — apply-all is fine.
