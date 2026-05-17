---
description: Run review skills in fix mode via the omnibus orchestrator. Re-audits, presents findings, applies approved fixes. Domains and scope inferred from plain-text args.
---
Invoke the `omnibus` skill with verb=`fix` and arguments: $ARGUMENTS

Parse `$ARGUMENTS` as plain text — no flag syntax. Tokens that match a domain name from `omnibus.yml` `active.fix` (code, design, docs, security, agent) filter the run to those domains. Everything else is a scope hint passed to the leaves.

Examples:

| `$ARGUMENTS` | Behavior |
|---|---|
| (empty) | re-audit + fix across all review skills |
| `code` | re-audit + fix code domain only |
| `src/research/` | re-audit + fix across all domains, scoped to that path |
| `security src/auth/` | security-review only (fix mode), scoped to src/auth/ |
| `agent` | agent-review in fix mode — covers config + hooks + skills + personas. Config structural fixes delegate to `agnix --fix-safe`. |
| `everything` | full codebase re-audit + fix |

Fix mode runs an audit pass first — the same omnibus preflight, fan-out, validation, and approval gates apply. Only approved findings are applied. Security findings require per-finding approval; other domains use single (per-slice) approval per `omnibus.yml`.
