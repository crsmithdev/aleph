# Vault maintenance

Maintenance ops of [vault](SKILL.md). Same script: `bun ~/.claude/skills/aleph/vault/cli.ts <op>`.

## rename-scope

`cli.ts rename-scope <old> <new>` is read-only; `--apply` writes. A rename
moves the repo and leaves every note behind, so the vault collected five
scope names for two projects. It rewrites only the `scope:` line, one commit
for the batch. An unknown scope refuses and names the ones that exist.

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

An `untracked` warning means the opposite: a note sits in `wiki/` that git
has never seen, because it was drafted in place and never went through
`write`. Put it through `adopt`.

## adopt

`cli.ts adopt <path-inside-the-vault> --why "<one line>"` commits a note
that is already in `wiki/` but that git has never seen. Use it for a draft
written in place, or a note Chris typed in Obsidian.

It applies every schema, folder, duplicate and dangling refusal, and demotes
the template to a warning, because a note on disk cannot be un-written. It
does not edit the note: an `## Evidence` heading nobody wrote would turn
"this claim is unbacked" into a passing check. Add the Home line yourself if
the kind wants one.

Use `write` instead for a new note, or to rewrite a tracked one.

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
