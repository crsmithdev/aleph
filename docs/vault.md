# Vault

The memory vault is an Obsidian vault at `~/.aleph/vault` (`ALEPH_VAULT` overrides the path). It is its own git repo. The agent writes it through `vault/cli.ts`, and you read and correct it in Obsidian. `VAULT.md` in the vault is the contract that you own; the agent never edits it.

Each op that commits also pushes to the vault's `origin`. Each op prints JSON on stdout and findings on stderr, and exits 1 when it refuses.

## Use it

```bash
bun vault/cli.ts init                                    # once, to create the vault
bun vault/cli.ts recall "verify gate"                    # rank notes by title, alias and body
bun vault/cli.ts recall --scope aleph                    # list one project's notes
bun vault/cli.ts write "A Note.md" --why "what changed"  # file a drafted note by its kind, and commit
bun vault/cli.ts lint --fix                              # check every note, and fix what is mechanical
bun vault/cli.ts compile 2026-11-02                      # a digest of one day's traces, handoffs and daily note
```

In a session, the `vault` skill runs these for you.

## Commands

| Command | Does |
|---|---|
| `init` | Creates the vault |
| `write <file> --why <text>` | Files a note by its `kind`, adds a line to the daily note, and commits |
| `recall [--episodes] <query> [--scope <name>]` | Ranks notes by title, alias, contains and body; `--scope` alone lists a scope's notes |
| `lint [--fix] [--overlap] [--template]` | Checks every note; `--fix` repairs what is mechanical |
| `adopt <path> --why <text>` | Takes in a note that was written in the vault by hand |
| `rename-scope <old> <new> [--apply]` | Renames a scope on every note |
| `consolidate [--apply]` | Merges notes that say the same thing |
| `archive <title> --why <text>` | Moves a note out of the index |
| `compile [date]` | Prints a digest of a day's Langfuse turns, handoffs and daily note |
| `misses [--days N]` | Read-only: the recall misses that Langfuse recorded |

## Note format

A note is `wiki/<kind>/<Title>.md`. It links other notes as `[[Title]]` and has this frontmatter:

```yaml
---
aliases: []
kind: gotcha            # decision | concept | entity | project | gotcha
scope: aleph            # a repo name, or global
confidence: measured    # measured | reported | inferred
updated: 2026-11-02
supersedes: []
sources: [jobs/lib/roles/unit.ts]
tags: []
---
```

`write` refuses a note with a bad schema, a duplicate, a dangling link, a folder that does not match its kind, a broken template, or one over the budget. It warns on an orphan, a stale measured claim, and an overlap with a note of the same scope. `compile` is the safety net for what the agent did not write on the day.
