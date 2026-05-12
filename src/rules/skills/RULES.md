# Skills Rules

Authoritative rules for SKILL.md files under `src/skills/`. Read by `skills-audit` and applied by `skill-creator` (the author-mode skill for this domain).

**Status: stub.** Will be populated in Phase 6 (skills/hooks/agents/config domain leaves are Construct-specific and net-new).

## Planned sections

- **A. Frontmatter** — required fields (`name`, `description`); optional fields (`verb`, `domain`, `modes`)
- **B. Description quality** — must mention triggering phrases; bad: "use when needed"; good: "trigger on phrases like X, Y, /<slash-command>"
- **C. Registry consistency** — every SKILL.md has a `skill-rules.json` entry with non-overlapping keywords
- **D. Progressive disclosure** — SKILL.md stays slim; detail in `references/`; load on demand
- **E. Purity** — no `Skill()` calls from leaf skills (only the omnibus chains; see `docs/plans/skill-architecture.md` R1)
- **F. Gate hardcoding forbidden** — call `gate("<domain>")`, do not bake `bun test.ts` etc. into the skill
- **G. Examples** — at least one `examples/` worked invocation per skill
