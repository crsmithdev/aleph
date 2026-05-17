---
description: Run review skills in fix mode via the omnibus orchestrator. Re-audits, presents findings, applies approved fixes. Domains and scope inferred from plain-text args.
---
Invoke the `omnibus` skill with verb=`fix` and arguments: $ARGUMENTS

Parse `$ARGUMENTS` as plain text — no flag syntax. Tokens that match a domain name from `omnibus.yml` `active.fix` (code, design, docs, agent) filter the run to those domains. The `security` token is also recognised — it dispatches `code-review --mode fix` with a security-tag filter (per-finding approval required for every security tag). Everything else is a scope hint passed to the leaves.

Examples:

| `$ARGUMENTS` | Behavior |
|---|---|
| (empty) | re-audit + fix across all review skills |
| `code` | re-audit + fix code domain only |
| `src/research/` | re-audit + fix across all domains, scoped to that path |
| `security src/auth/` | code-review (fix mode, security-tag filter), scoped to src/auth/ — per-finding approval required for every security tag |
| `agent` | agent-review in fix mode — covers config + hooks + skills + personas. Config structural fixes delegate to `agnix --fix-safe`. |
| `everything` | full codebase re-audit + fix |

Fix mode runs an audit pass first — the same omnibus preflight, fan-out, validation, and approval gates apply. Only approved findings are applied. Security findings require per-finding approval; other domains use single (per-slice) approval per `omnibus.yml`.
