# VAULT.md — the contract

This file is **human-owned**. The agent may propose a diff in `wiki/decisions/`
and ask; it may never edit this file. Enforcement is at the mount (`:ro`), not here.

This vault is **AI-first**: most reads and writes are the agent's, and Chris's
notes in `human/` are protected guests. The layout optimises for deterministic
write paths — if the agent has to infer where something belongs, the structure
is too clever and the structure is wrong, not the agent.

## Prohibitions (absolute)

1. Never write anywhere under `human/`. Read-only, always. It is bind-mounted
   read-only into every sandbox; a write attempt is a bug and is logged as
   `vault.write_denied`.
2. Never edit this file. Propose a diff in `wiki/decisions/` and ask.
3. Never append to a note that has a canonical section for the claim — rewrite
   the section. Sprawl is the failure mode, not staleness.
4. Never delete. Move to `archive/` with a frontmatter `archived_reason`.
5. Never write to `log/` outside the current day's file.
6. Never put a secret, token, or key in the vault. If one arrives in a message,
   redact it and note the redaction.
7. Never restructure directories, rename namespaces, or change frontmatter
   schemas without explicit approval.

## Read order (always)

1. `index.md` — the catalog.
2. `MEMORY.md` — standing context.
3. The specific note named by the index.

Only then search. Index-first is not a preference; a search-first agent
rediscovers the same facts every session and never notices the vault is drifting.

## Namespaces

| Path | Owner | Write rule |
|---|---|---|
| `wiki/` | agent | rewrite-don't-append; per-write git commit |
| `log/` | agent | append, today's file only; nightly commit |
| `inbox/` | agent | capture staging; the librarian empties it |
| `research/` | agent | reports; typed frontmatter |
| `human/` | Chris | agent read-only |
| `attachments/` | agent | binary only; excluded from phone sync |
| `archive/` | agent | demoted memory; never hard-deleted |

## Frontmatter

Every note in `wiki/` and `research/` carries at least:

```yaml
---
title: <human title>
updated: <RFC3339 UTC>
tags: []
---
```

Claims that can go stale carry a recency marker in the text
(`as of 2026-08-20`), because a confident sentence with no date is the way a
vault rots without anyone noticing.
