# Rules

Per-domain rule sets, shared between `<domain>-audit` (post-hoc check) and `<domain>-author` (write-time enforcement). One source, two execution modes.

Each domain has a primary `RULES.md` plus optional reference files that progressively disclose (loaded by leaves only when relevant). Layout:

```
src/rules/
├── README.md              # this file
├── code/
│   ├── RULES.md           # primary rule set, sectioned by area
│   ├── react.md           # framework-specific (loaded on demand)
│   ├── typescript.md
│   └── ...
├── design/
│   ├── RULES.md
│   ├── typography.md      # from former design-type
│   ├── accessibility.md   # from former design-standards
│   └── ...
├── docs/
│   ├── RULES.md           # canonical doc rule set (moved from docs-author-v2/)
│   ├── SUGGESTIONS.md     # proposed rule additions awaiting approval
│   └── ...
├── skills/
│   └── RULES.md
├── hooks/
│   └── RULES.md
├── agents/
│   └── RULES.md
├── config/
│   └── RULES.md
└── security/
    ├── RULES.md
    ├── owasp-top-10.md
    ├── cwe-top-25.md
    └── ...
```

## Citation format

Findings cite rules as `<domain>/RULES.md#<section-anchor>` — e.g. `code/RULES.md#A.2-secrets`. The section anchor is the markdown heading slug. Tooling can deep-link from a finding directly to the rule.

## Migration status

This directory is currently scaffolding. The skill-architecture migration (`docs/plans/skill-architecture.md`, Phase 2) will populate each `RULES.md` by consolidating content from the legacy skills:

| Domain | Legacy source | Migration status |
|---|---|---|
| `code` | `src/skills/code-review/SKILL.md` §1-8, scattered CLAUDE.md rules | Stub |
| `design` | `src/skills/design-audit/`, `design-standards/`, `design-type/` | Stub |
| `docs` | (moved from `src/skills/docs-author-v2/RULES.md`) | **Populated** |
| `skills` | `src/skills/skill-creator/` (rules buried in process) | Stub |
| `hooks` | `src/skills/config-audit/SKILL.md` Phase 2 + Construct-specific hook conventions | Stub |
| `agents` | Construct conventions (mostly net-new) | Stub |
| `config` | `src/skills/config-audit/SKILL.md` Phase 1 + 3 + 4 | Stub (agnix covers most) |
| `security` | `claude-code-security-review` categories, OWASP/CWE/NIST/ASVS | Stub (net-new) |

## When to add content

Do **not** populate these files until the corresponding leaf skill is being built. Premature content rots faster than skills are written. Each `RULES.md` should grow from a real audit pass that surfaced gaps, not from a brainstorm of "what rules might we want."
