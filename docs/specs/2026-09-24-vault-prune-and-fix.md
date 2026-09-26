# Vault prune and lint --fix

Written 2026-09-24 after a session hit the `Home.md` budget and found nothing
to help it. Rewritten the same day, after the archaeology below showed the
first draft's cause was wrong. Built.

## Problem Statement

The first draft said the template rules tightened and 73 notes never caught up.
That is not what happened. `git log -S` on both rule strings in
`vault/lib/vault.ts` returns one commit, `3d41a48`, the day the vault shipped.
No note ever lived under a looser rule.

The notes bypassed the gate. `commitAll` was `git add -A`, so every op staged
the whole vault. A file lying in `wiki/` rode into history on the next op's
commit, whoever put it there and whether or not a write had accepted it.

| Measure | Count |
| --- | --- |
| notes added on a commit whose subject names a different note | 102 of 137 |
| notes that refused lint | 73 |
| refusing notes that entered that way | 67 (92%) |

The loop that made this permanent: a session drafts a note inside the vault,
`vault write` refuses it, the refusal returns before the disk section so it
rolls nothing back, the invalid file stays untracked in `wiki/`, and the next
successful write adopts it. Same defect class as the rollback bug in `b089def`:
an op that acts on the whole tree instead of its own paths.

Second problem, unchanged from the first draft: **`Home.md` has a hard budget
and no way to meet it.** `LINE_BUDGET` is 150 and `Home.md` is at 150. A write
that would push it over is refused, and the caller is left hand-editing an index
file it has no policy for.

## Solution

### Commit only the paths the op touched

`commitAll` is gone. `commitPaths(dir, subject, paths)` stages and commits the
given pathspecs and nothing else. `write` already tracked `touched`; `lint`
commits `Home.md` and whatever `--fix` repaired; `init` commits the files it
laid down. An unaccepted note now stays untracked, where `git status` shows it.

A refusal also names a file that sits at its destination and that git does not
track. It does not delete it: the file may be Chris's own note, typed in
Obsidian, and `b089def` is what undoing another writer's work costs.

### `vault lint --fix`

One rule: **`--fix` edits frontmatter and never the body.** Frontmatter is
structural and each defect below has one right answer. A missing `## Evidence`
or `as of` marker is a claim about the world; appending the heading would turn
"this claim is unbacked" into a passing check and lose the only way to find an
unbacked claim later.

| Refusal | Repair |
| --- | --- |
| `missing supersedes` | add `supersedes: []` — absent and `[]` mean the same thing |
| a list key holding a bare scalar | wrap it, but only when the raw text is a plain scalar |
| `missing updated` | the date the note entered git |

Everything else is reported, not repaired: `confidence` outside the enum is a
claim about how a fact was learned, and a missing `kind`, `scope` or `sources`
is a claim no repair can make true.

`updated` takes the date the file entered git, not its last commit date. A
housekeeping commit moves the last date, and `updated` is the one field the
`stale` warning reads: under-dating asks for a re-check that is not needed,
where over-dating hides one that is.

Edits are line-level, so a note keeps its own formatting and the diff stays
readable. Run it read-only by default; `--fix` writes one commit, subject
`lint --fix: <n> notes`.

### `lint` reports the template; `write` gates it

`write` is the gate and still refuses on the template. `lint` reports a vault
that already exists, where a note on disk cannot be un-written, so template
findings warn — one collapsed line per note, not one per missing heading. The
refuse list falls from 170 to 40, and to 22 after `--fix`.

### The budget refusal carries its own proposal

No standing `prune` op. The moment the caller needs the candidates is the moment
the budget refuses, so `homeCandidates` ranks `Home.md`'s index lines and the
refusal prints exactly as many as the file is over. It ranks by facts about the
target note: the link resolves to nothing, the note is archived, then oldest
`updated`. **It removes nothing.** The note stays on disk and `recall` finds it.

Home holds 132 index lines for 137 notes, so it is an inventory, not a map. What
Home is for is still open, and a heading-level cap is the likelier answer than
any ranking. This refusal hint is the stopgap that unblocks a write.

## Consequences

The dry run against a copy of the vault changed 16 files, 18 insertions, 0
deletions, every line frontmatter. Take the copy with `cp -aL`:
`~/.aleph/vault` is a symlink to `/mnt/c/Users/crsmi/vault`, and `cp -a`
copies the symlink, so the "copy" is the live vault. That mistake put one bad
commit on the real vault on 2026-09-24; `0385a9c` reverts it.

`~/.aleph/vault` being a symlink cost a second time on 2026-09-26. A write
guarded its copy with `srcPath !== dest`, a string compare, so a note given its
`/mnt/c/...` path was copied onto itself through the `~/.aleph` spelling and
`copyFileSync` truncated it to 0 bytes. Two notes went that way. Both were in
git, because another session had written them minutes earlier; a note that had
never been written would have been gone. The root and a write's source now
resolve through symlinks, so the guard compares one spelling against itself.

A parser bug surfaced only in that dry run. `parseFrontmatter` cut every line at
` #`, so `aliases: [deep link a draw, #go]` lost its closing bracket, parsed as
a string, and lint called it "aliases must be a list". `stripComment` now
ignores a `#` inside quotes or brackets.

`--fix` still edits many notes at once. Run it against a real copy and read the
diff. Neither op should run as a hook or unattended.

## Related

- `docs/specs/2026-09-04-memory-vault.md` — the vault's design
- `vault/lib/git.ts` — `commitPaths`
- `vault/lib/vault.ts` — `fixFrontmatter`, `homeCandidates`, `lintVault`
- `b089def` — the rollback fix this spec's Problem Statement cites
