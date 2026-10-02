---
name: vault
description: >
  Read and write the memory vault at ~/.aleph/vault. Use when the user asks to
  remember something or what we know about X; when you learn how something
  behaves, decide something or get corrected; or to run lint or compile.
---

The vault is memory. Home.md and MEMORY.md are already in context from
SessionStart. Read the note Home points at before searching; search with
`recall` before deriving anything from scratch.

Script: `bun ~/.claude/skills/aleph/vault/cli.ts <op>`. JSON on stdout,
findings on stderr, exit 1 on refusal. Never edit `VAULT.md`.

Every op that commits also pushes to `origin`, the private repo
`crsmithdev/aleph-vault`. A push that fails prints `warn push` and leaves the
commit; the next op sends it. The vault held 165 notes on one drive with no
second copy until 2026-09-26, so do not turn this off.

To run lint, consolidate, adopt, archive or rename-scope, read
[MAINTAIN.md](MAINTAIN.md) first.

## write

Write a page when you learn how something actually behaves (`gotcha`),
decide something (`decision`), learn what something is (`entity`, `concept`),
or change a project's state (`project`). One page per fact. Rewrite the
existing page rather than writing a second one about the same thing; set
`supersedes` when the old page is now wrong.

**`recall` first.** If a page already covers the fact, rewrite that page.

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
   ---
   ```

   Body: `**Claim.** <one or two sentences>, as of <date>.` then
   `## Details`, `## Evidence`, `## Related` with `[[links]]` to notes that
   exist. `[[Home]]` is always a valid link.
2. `cli.ts write "<path>" --why "<one line>"`. The script files it by kind,
   appends the daily note, sets the health line and commits. A refusal
   names the rule; fix the draft and rerun. Warnings are yours to judge.
3. For a `decision`, `project`, `concept` or `entity`, add one line under
   the kind's heading in `Home.md`: `- [[Title]] — <hook, under ten words>`,
   then `cli.ts write ~/.aleph/vault/Home.md --why "<why>"`. An orphan
   warning means this step was missed. **A gotcha gets no Home line.** Home
   routes to the standing kinds; `recall` finds the rest.

MEMORY.md holds standing context about Chris and the environment. Rewrite
the section, keep it under 150 lines, commit the same way.

## recall

`cli.ts recall "<query>"` ranks title, alias, contains, body. Read the
note it returns; do not paraphrase Home from memory.

`--scope <name>` narrows the search to one project, and on its own lists
that scope's notes — this is how you answer "what do we know about X". An unknown scope prints
the scopes that exist, because the vault still has several names for one
project.

## compile

`cli.ts compile [YYYY-MM-DD]` prints a digest of the day's Langfuse turns,
handoffs and daily note, plus trace ids already cited. From it, propose
notes: list title, kind and one-line claim for each and wait for approval.
Then draft and `write` each approved note, citing `trace:<id>` in sources.
Never write from compile without approval.
