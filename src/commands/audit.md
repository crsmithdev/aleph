---
description: Run audit leaves via the omnibus orchestrator. Domains and scope inferred from plain-text args.
---
Invoke the `omnibus` skill with verb=`audit` and arguments: $ARGUMENTS

Parse `$ARGUMENTS` as plain text — no flag syntax. Tokens that match a domain name from `omnibus.yml` `active.audit` (code, design, docs, skills, hooks, agents, config, security) filter the run to those domains. Everything else is a scope hint passed to the leaves.

Examples:

| `$ARGUMENTS` | Behavior |
|---|---|
| (empty) | all audit cells, default scope (diff vs main) |
| `code design` | code-audit + design-audit only |
| `src/research/` | all audit cells, scoped to that path |
| `the research module` | all audit cells, scoped to research-related files |
| `everything` | full codebase scan, all audit cells |
| `code src/foo/` | code-audit only, scoped to src/foo/ |

If no scope hint is given and the working tree is clean on main, omnibus falls back to `HEAD~10` per its preflight.
