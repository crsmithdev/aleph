---
description: Run review skills in audit mode via the omnibus orchestrator. Domains and scope inferred from plain-text args.
---
Invoke the `omnibus` skill with verb=`audit` and arguments: $ARGUMENTS

Parse `$ARGUMENTS` as plain text — no flag syntax. Tokens that match a domain name from `omnibus.yml` `active.audit` (code, design, docs, agent) filter the run to those domains. The `security` token is also recognised — it dispatches `code-review` with a security-tag filter (security is a rule family within code-review, not a separate domain). Everything else is a scope hint passed to the leaves.

Examples:

| `$ARGUMENTS` | Behavior |
|---|---|
| (empty) | all review skills in audit mode, default scope (diff vs main) |
| `code design` | code-review + design-review in audit mode only |
| `src/research/` | all review skills in audit mode, scoped to that path |
| `the research module` | all review skills, scoped to research-related files |
| `everything` | full codebase scan, all review skills |
| `code src/foo/` | code-review only (audit mode), scoped to src/foo/ |
| `agent` | agent-review only — covers config + hooks + skills + personas in one pass |

Audit mode is read-only: review skills emit SARIF findings + a phased prose summary, but never apply fixes. Use `/fix` for the apply-after-approval variant.

If no scope hint is given and the working tree is clean on main, omnibus falls back to `HEAD~10` per its preflight.
