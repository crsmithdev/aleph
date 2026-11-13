---
name: vault
description: >
  Read and write the memory vault at ~/.aleph/vault. Use when the user asks to
  remember something or what we know about X; when you learn how something
  behaves, decide something or get corrected; or to run lint or compile.
---

The vault is memory. MEMORY.md and the core lines of this repo and `global`
are already in context from SessionStart. Each core line ends with its note's
`[[title]]`: read that note before searching, and search with `recall` before
deriving anything from scratch.

Script: `aleph memory <op>`. JSON on stdout,
findings on stderr, exit 1 on refusal. Never edit `VAULT.md`.

Every op that commits also pushes to `origin`, the private repo
`crsmithdev/aleph-vault`. A push that fails prints `warn push` and leaves the
commit; the next op sends it. The vault held 165 notes on one drive with no
second copy until 2026-09-26, so do not turn this off.

To run lint, adopt, archive or rename-scope, read
[MAINTAIN.md](MAINTAIN.md) first.

## write

Write a page when you learn how something actually behaves (`gotcha`),
decide something (`decision`), learn what something is (`entity`, `concept`),
or change a project's state (`project`). One page per fact. Rewrite the
existing page rather than writing a second one about the same thing; set
`supersedes` when the old page is now wrong; list a related page the
screen flags but that you agree with in `consistent_with: [<title>]`.

**A gotcha has to earn its page.** Write one when the behaviour cost you a
debugging session and the next session would pay again. Do not write one for
a fact you could re-derive in a minute from the code, `--help` or an error
message; that is a search, not a memory. A gotcha that names a version or a
tool you do not control rots fast, so say the date and the version in the
claim.

The vault ran at 98 gotchas to 20 decisions in its first 20 days, and the
index had weeks left. Decisions and projects are what a later session cannot
re-derive at any price. Prefer them.

1. Draft the note in the scratchpad as `<Title>.md`. Title Case, unique,
   no `/ \ : * ? " < > |`. Frontmatter:

   ```yaml
   ---
   aliases: []
   kind: gotcha            # decision | concept | entity | project | gotcha
   scope: aleph            # repo name, or global
   confidence: measured    # measured (you ran it) | reported (someone said) | inferred
   updated: 2026-09-04
   supersedes: []
   sources: [trace:<id>, docs/verify-gate.md, chris]
   tags: []
   core: <optional: one line, at most 160 characters, always on in this scope>
   ---
   ```

   Body: `**Claim.** <one or two sentences>, as of <date>.` then
   `## Details`, `## Evidence`, `## Related` with `[[links]]` to notes that
   exist. `[[Home]]` is always a valid link.
2. `aleph memory write "<path>" --why "<one line>"`. The script files it by kind,
   appends the daily note, regenerates Home.md and commits. A refusal names
   the rule; fix the draft and rerun. Warnings are yours to judge.

Home.md is generated from the notes on each write. Never edit it.

**`core:` is for a fact every session in the scope needs before it starts**,
such as a decision in force. It is injected at every session start, so the
budget is small: MEMORY.md plus the core lines of a scope and `global` must
fit in 6,000 bytes. A write over that is refused with the scope's core lines
ranked oldest first; remove the `core:` field of one (the note stays and
`recall` finds it), or leave `core:` off the new note. Most notes have no
core line.

MEMORY.md holds standing context about Chris and the environment. Rewrite
the section, keep it under 150 lines, commit the same way.

## recall

`aleph memory recall "<query>"` ranks title and alias matches and a full-text
search of each note, fused. `rank` is 0 for the title, 1 for an alias, 2 for
a title or alias that holds the query, 3 for the body only. Read the note it
returns; do not paraphrase from memory.

`--scope <name>` narrows the search to one project, and on its own lists
that scope's notes — this is how you answer "what do we know about X". An unknown scope prints
the scopes that exist, because the vault still has several names for one
project.

## compile

`aleph memory compile [YYYY-MM-DD]` prints a digest of the day's Langfuse turns,
handoffs and daily note, plus trace ids already cited. From it, propose
notes: list title, kind and one-line claim for each and wait for approval.
Then draft and `write` each approved note, citing `trace:<id>` in sources.
Never write from a compile you run by hand without approval. The daily maintainer
(`aleph memory maintain`) runs its own compile and writes with `write` on its own;
each write is a pushed, revertible vault commit.
