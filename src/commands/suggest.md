---
description: Run suggest leaves via the omnibus orchestrator. Proactive suggestions (post-v1; suggest cells currently empty). Domains and scope inferred from plain-text args.
---
Invoke the `omnibus` skill with verb=`suggest` and arguments: $ARGUMENTS

Parse `$ARGUMENTS` as plain text — no flag syntax. Tokens that match a domain name from `omnibus.yml` `active.suggest` filter the run to those domains. Everything else is a scope hint passed to the leaves.

Today's status: all `suggest` cells in the registry are empty — the proactive-suggestion variant of audit is post-v1 work. Running `/suggest` will produce a "no suggest leaves installed" report rather than findings. The command exists so the verb is reserved and discoverable; wire leaves into `omnibus.yml` `active.suggest` to enable.
