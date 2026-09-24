---
name: vault
description: Read and write the memory vault at ~/.aleph/vault (Obsidian notes the agent owns). Use when the user says "remember this", "write that down", "what do we know about X", "/vault", when you learn how something actually behaves, decide something, or get corrected, or to run lint or compile over the vault.
---

The vault is memory. Home.md and MEMORY.md are already in context from
SessionStart. Read the note Home points at before searching; search with
`recall` before deriving anything from scratch.

Script: `bun ~/.claude/skills/aleph/vault/cli.ts <op>`. JSON on stdout,
findings on stderr, exit 1 on refusal. Never edit `VAULT.md`.

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

## consolidate

`cli.ts consolidate` is read-only. It reports the Home lines it would drop
(dead pointers, archived targets, gotchas), the notes that want a Home line,
the claims past their decay window, and the bodies that say "yesterday"
instead of a date. `--apply` rebuilds Home and commits. It writes no index
line: a hook is prose, so you write it.

A claim's window is its kind's budget, times its confidence — `measured`
1.5, `reported` 1, `inferred` 0.5 — counted from the later of `updated` and
the last `recall` that returned it. Base days: project 30, gotcha 60,
decision 180, concept and entity 365.

## archive

`cli.ts archive "<title>" --why "<one line>"` retires a note when the
subject is over and no replacement exists. It moves the file to `archive/`
with a reason, drops its Home line, and names every note that links to it.
Nothing is deleted and the note stays a link target. Use `supersedes` in a
write instead when a newer note covers the same ground.

A `deleted` warning means git tracks a note that is gone from disk. Restore
it and archive it; no op will commit a bare deletion.

## recall

`cli.ts recall "<query>"` ranks title, alias, contains, body. Read the
note it returns; do not paraphrase Home from memory.

## lint

`cli.ts lint` prints refusals and warnings for the whole vault and sets the
health line. Run it after a batch of writes or when Home's health line
shows dangling links or orphans. Refusals are structural: schema, folder,
duplicate title, dangling link, budget. A broken template warns instead,
because a note on disk cannot be un-written; past one note the warnings
collapse to a count, and `lint --template` names them.

`cli.ts lint --fix` repairs frontmatter and never the body: it adds a
missing `supersedes: []`, wraps a list key holding a bare scalar, and fills a
missing `updated` with the date the note entered git. It never adds a `## Evidence` heading or an
`as of` marker; those are claims about the world, and a heading that says
nothing hides an unbacked claim. Read the diff before you commit anything
else.

A refusal that names a file "no write has accepted" means the file sits in
`wiki/` but never passed the gate. Fix it and rerun, or remove it. No op
commits a path it did not touch, so such a file stays untracked.

## compile

`cli.ts compile [YYYY-MM-DD]` prints a digest of the day's Langfuse turns,
handoffs and daily note, plus trace ids already cited. From it, propose
notes: list title, kind and one-line claim for each and wait for approval.
Then draft and `write` each approved note, citing `trace:<id>` in sources.
Never write from compile without approval.
