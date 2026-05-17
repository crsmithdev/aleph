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
│   ├── typography.md      # walked by design-review (section B); also `design-type` for write-time enforcement
│   ├── accessibility.md   # walked by design-review (sections L-R); was former design-standards
│   ├── css-templates.md   # baseline CSS / responsive / OpenType
│   ├── html-entities.md   # entity substitution reference
│   └── ...
├── docs/
│   ├── RULES.md           # canonical doc rule set walked by docs-review (audit/fix/enforce modes)
│   ├── SUGGESTIONS.md     # proposed rule additions awaiting approval
│   └── ...
├── agent/                 # AI-runtime config: walked by agent-review across 4 sub-surfaces
│   ├── RULES.md           # entry point
│   ├── config.md          # CLAUDE.md, settings.json
│   ├── hooks.md           # src/core/hooks/*.ts, settings-hooks.json
│   ├── skills.md          # src/skills/*/SKILL.md, skill-rules.json
│   └── personas.md        # src/agents/*.md
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

| Domain | Walked by | Status |
|---|---|---|
| `code` | `code-review` (audit + fix modes; slop removal, drift propagation, consolidation, restructure) | **Populated** |
| `design` | `design-review` (audit + fix modes); `design-type` for write-time typography enforcement | **Populated + consolidated** (umbrella + 4 reference files) |
| `docs` | `docs-review` — audit (find drift), fix (apply approved findings), enforce (auto-apply rules while drafting or editing markdown — covers from-scratch authoring too) | **Populated** |
| `agent` | `agent-review` (audit + fix modes across config/hooks/skills/personas sub-surfaces) | **Populated** (umbrella + 4 sub-surface files) |
| `security` | `security-review` (audit + fix modes; OWASP/CWE/NIST/ASVS/MITRE-ATT&CK mapped) | Stub (net-new) |

## When to add content

Do **not** populate these files until the corresponding leaf skill is being built. Premature content rots faster than skills are written. Each `RULES.md` should grow from a real audit pass that surfaced gaps, not from a brainstorm of "what rules might we want."
