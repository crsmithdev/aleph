---
name: agent-review
description: Review all AI-runtime config — CLAUDE.md, hooks, skills, agent personas — against `src/rules/agent/RULES.md` and its four sub-surface rule files. Scans, presents findings grouped by severity, asks at the approval gate, applies approved fixes, verifies. Covers four sub-surfaces in a single walk: config (CLAUDE.md, settings.json), hooks (src/core/hooks/*.ts), skills (src/skills/*/SKILL.md, skill-rules.json), personas (src/agents/*.md). Cross-sub-surface drift (persona referencing a renamed skill, hook writer→consumer pairs, skill-rules entries vs SKILL.md files on disk) is a first-class finding. Triggers on /agent-review, /audit agent, "audit my config", "audit the agent setup", "audit my hooks", "are my hooks wired", "audit my skills", "find orphaned skills", "audit my agents", "find agent drift", "check cross-domain drift", "what's broken in my setup".
---

# agent-review

Scans all AI-runtime config (CLAUDE.md, hooks, skills, agent personas) against the agent rule set, presents findings grouped by severity, asks at the approval gate, applies approved fixes.

<!-- BEGIN: orchestration -->

## Process

1. **Scope.** `git diff --name-only $(git merge-base HEAD main)..HEAD`. If empty on clean main, fall back to `--since HEAD~10`; if still empty, scope defaults to the entire codebase — every file matching the Domain table below. Pass `--module <path>` to narrow.
2. **Scan** the rules in Domain below. For each hit: file:line, rule cite, one-line message, fix, severity (blocking / important / nit / suggestion / praise).
3. **Re-read** each cited location. Drop false positives.
4. **Report** grouped by severity. One line per finding: `path:line — rule — message. Fix: ...`.
5. **STOP. Ask.** Security findings (secrets, auth, injection, crypto, RCE, IDOR, SSRF, XSS) → one at a time, no bulk path. Otherwise: apply all / pick / discard.
6. **Apply** approved fixes.
7. **Gate.** Run the command in Domain. On failure: report as a new blocking finding, stop.
8. **Closing:** `Applied N. Touched M files. Gate green. Skipped: <list>.`

## Guardrails

- Leaves never call `Skill()`.
- Nothing edits before step 5.
- No green closing without a green gate.

<!-- END: orchestration -->

## Domain

Four sub-surfaces in one walk; every finding tags `properties.sub_surface`:

| Sub-surface | Files | Rules |
|---|---|---|
| config | `CLAUDE.md`, `settings.json`, `.claude/**` | `src/rules/agent/config.md` |
| hooks | `src/core/hooks/*.ts`, `settings-hooks.json` | `src/rules/agent/hooks.md` |
| skills | `src/skills/*/SKILL.md`, `skill-rules.json` | `src/rules/agent/skills.md` |
| personas | `src/agents/*.md`, `.claude/agents/*.md` | `src/rules/agent/personas.md` |

- Gate: `bun test src/skills src/core/hooks`
- Cross-sub-surface drift — a persona referencing a renamed skill, a hook writer with no consumer, a `skill-rules.json` entry pointing at a missing SKILL.md, a CLAUDE.md `@`-include that doesn't resolve — is a first-class finding emitted by the leaf itself. No external coordinator needed.
- agnix structural lint (CC-SK-*, AGM-*, XP-*) runs as a passthrough for config-bucket findings; this skill adds the semantic layer.
- Per-finding approval required for: `pii`, `secret`, `over-privileged`, `r1-violation`, `dead-output` (deletion path), any rename operation.
