---
name: audit
description: Run review skills across one or more domains. No coordination — each leaf runs its own full scan → present → approve → fix → gate lifecycle and reports independently. Triggers on /audit, "audit the code", "audit the design", "audit the docs", "audit my config", "audit my setup", "review everything", "check all the things", "audit everything", "full audit", "comprehensive audit".
---

# audit

Fan-out dispatcher. Plain-text args name the domains to run. No args = all four.

| Invocation | Dispatches |
|---|---|
| `/audit code` | `code-review` |
| `/audit design` | `design-review` |
| `/audit docs` | `docs-review` |
| `/audit agent` | `agent-review` |
| `/audit code design` | `code-review`, then `design-review` |
| `/audit` | `code-review`, `design-review`, `docs-review`, `agent-review` — in that order |

`/audit security` is a synonym for `/audit code` (security is a rule family inside code-review).

## Process

1. Parse args. Unknown domain → exit with `unknown domain: <name>. Valid: code, design, docs, agent, security.`
2. Invoke each named leaf **sequentially** via `Skill()`. Parallel dispatch creates concurrent approval prompts and is forbidden.
3. Each leaf runs its own full lifecycle and produces its own report.
4. If a leaf's gate fails, stop the chain. Do not run subsequent leaves. Surface the failure and the partial-completion state.

## Guardrails

- This skill is the only allowed `Skill()` caller across the review pipeline. The four review leaves remain pure.
- No merging, no dedupe, no cross-leaf approval shaping — by design.
- No flag parsing beyond domain names. Scope, threshold, and approval shape are the leaf's call.
- No audit-vs-fix verb split. Every invocation scans first; the leaf's approval gate is where "apply / pick / discard" lives.
