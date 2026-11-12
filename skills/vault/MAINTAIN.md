# Vault maintenance

Maintenance ops of [vault](SKILL.md). Same script as the one SKILL.md names.

## rename-scope

`aleph memory rename-scope <old> <new>` is read-only; `--apply` writes. A rename
moves the repo and leaves every note behind, so the vault collected five
scope names for two projects. It rewrites only the `scope:` line, one commit
for the batch. An unknown scope refuses and names the ones that exist.

## Decay

`lint` warns `stale` for a claim past its decay window. A claim's window is its kind's budget, times its confidence — `measured`
1.5, `reported` 1, `inferred` 0.5 — counted from the later of `updated` and
the last `recall` that returned it. Base days: project 30, gotcha 60,
decision 180, concept and entity 365.

## archive

`aleph memory archive "<title>" --why "<one line>"` retires a note when the
subject is over and no replacement exists. It moves the file to `archive/`
with a reason, regenerates Home, and names every note that links to it.
Nothing is deleted and the note stays a link target. Use `supersedes` in a
write instead when a newer note covers the same ground.

A `deleted` warning means git tracks a note that is gone from disk. Restore
it and archive it; no op will commit a bare deletion.

An `untracked` warning means the opposite: a note sits in `wiki/` that git
has never seen, because it was drafted in place and never went through
`write`. Put it through `adopt`.

## adopt

`aleph memory adopt <path-inside-the-vault> --why "<one line>"` commits a note
that is already in `wiki/` but that git has never seen. Use it for a draft
written in place, or a note Chris typed in Obsidian.

It applies every schema, folder, duplicate and dangling refusal, and demotes
the template to a warning, because a note on disk cannot be un-written. It
does not edit the note: an `## Evidence` heading nobody wrote would turn
"this claim is unbacked" into a passing check.

Use `write` instead for a new note, or to rewrite a tracked one.

## lint

`aleph memory lint` prints refusals and warnings for the whole vault, regenerates
Home and sets its health line. Run it after a batch of writes or when the
health line shows dangling links. It also warns `relative-date` for a body
that says "yesterday" instead of a date. Refusals are structural: schema, folder,
duplicate title, dangling link, budget. A broken template warns instead,
because a note on disk cannot be un-written; past one note the warnings
collapse to a count, and `lint --template` names them.

`aleph memory lint --fix` repairs frontmatter and never the body: it adds a
missing `supersedes: []`, wraps a list key holding a bare scalar, and fills a
missing `updated` with the date the note entered git. It never adds a `## Evidence` heading or an
`as of` marker; those are claims about the world, and a heading that says
nothing hides an unbacked claim. Read the diff before you commit anything
else.

A refusal that names a file "no write has accepted" means the file sits in
`wiki/` but never passed the gate. Fix it and rerun, or remove it. No op
commits a path it did not touch, so such a file stays untracked.
