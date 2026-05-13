---
description: Run fix leaves via the omnibus orchestrator. Re-audits, presents findings, applies approved fixes. Domains and scope inferred from plain-text args.
---
Invoke the `omnibus` skill with verb=`fix` and arguments: $ARGUMENTS

Parse `$ARGUMENTS` as plain text — no flag syntax. Tokens that match a domain name from `omnibus.yml` `active.fix` (code, design, docs, skills, hooks, agents, security — note `config` has no fix leaf) filter the run to those domains. Everything else is a scope hint passed to the leaves.

Examples:

| `$ARGUMENTS` | Behavior |
|---|---|
| (empty) | re-audit + fix across all populated fix cells |
| `code` | re-audit + fix code domain only |
| `src/research/` | re-audit + fix across all cells, scoped to that path |
| `security src/auth/` | security-fix only, scoped to src/auth/ |
| `everything` | full codebase re-audit + fix |

Fix never runs without an audit pass first — the same omnibus preflight, fan-out, validation, and approval gates apply. Approved findings only.
