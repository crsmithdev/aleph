# Vault prune and lint --fix

Written 2026-09-24 after a session hit the `Home.md` budget and found nothing
to help it. Not built. Two new ops on `vault/cli.ts`.

## Problem Statement

The vault has five ops — `init`, `write`, `recall`, `lint`, `compile` — and
every one of them only ever adds. `lint` names problems and fixes none.
Archiving happens only as a side effect of `supersedes:` in a write, which
needs a replacement note. `VAULT.md` says notes are never deleted, and that is
right for notes. Nothing covers the two places where the vault needs to lose
weight.

**`Home.md` has a hard budget and no way to meet it.** `LINE_BUDGET` is 150 and
`Home.md` is at 150. A write that would push it over is refused, and the agent
is then left hand-editing an index file it has no policy for. On 2026-09-24
that refusal is what made a session ask Chris which of his own memory lines to
drop — there was no tool to ask instead. Three notes currently have no index
line, and one of them is an orphan only because a line was removed to fit two
new ones.

**The template rules tightened and 73 notes never caught up.**

```
170 refusals across 73 notes
  57  claim missing an `as of YYYY-MM-DD` marker
  47  missing section ## Evidence
  16  missing supersedes
  11  missing ## Details        11  missing ## Related
   3  body does not open with **Claim.**
   3  confidence not one of measured|reported|inferred
  12  missing frontmatter keys (2 notes)
```

No write touches those notes, so they sit refused for ever. The volume is the
damage: a real problem in that list cannot be seen. About 90 of the 170 are
mechanical.

## Solution

### `vault lint --fix`

Apply only the repairs that need no judgement, print what changed, touch no
prose. In scope:

| Refusal | Repair |
| --- | --- |
| `missing supersedes` | add `supersedes: []` |
| `confidence` not in the enum | `observed` and `documented` → `measured` when the body cites a run, else `reported`; anything else is left and reported |
| missing `## Evidence`, `## Details`, `## Related` | append the heading with an explicit `_Not recorded._` line, never invented content |
| missing `kind`, `scope`, `updated`, `sources` | `updated` from git's last commit date for the file; the rest left for a human, and named |
| `aliases must be a list` | wrap a bare string |

Out of scope, because each is a claim about the world: the 57 missing `as of`
markers, the 3 missing `**Claim.**` openings, every dangling link. `--fix`
prints these as the remaining list.

Run it read-only by default; `--fix` writes. One commit, subject
`lint --fix: <n> notes`.

### `vault prune`

Read-only by default. Rank the lines of `Home.md` for removal and print a
proposal that brings the file under budget. `--apply` writes it.

Rank by, in order: the target note is an orphan of its own heading; a newer
note in the same scope covers the same ground (the existing `overlap` warning
already computes this); the note is old and its subject is retired, which its
own hook usually says; the line is one of a run of three or more about one
series.

**Prune removes index lines only.** The note stays on disk, tracked, and
`recall` still finds it. Nothing is deleted and nothing is archived, so
`VAULT.md`'s rule holds unchanged.

## Consequences

`lint --fix` is mechanical but it edits 73 notes at once, so run it against a
copy of the vault and read the diff before letting it near the real one. That
is not paranoia: on 2026-09-24 a rollback in `write` deleted two uncommitted
notes and six lines of `Home.md` (fixed in `b089def`), and the only reason
anything came back is that a session happened to be holding the text.

`prune` decides what Chris stops seeing at session start. It should stay
read-only by default for a long time, and `--apply` should print the removed
lines so they can be pasted back.

Neither op should exist as a hook or run unattended.

## Related

- `docs/specs/2026-09-04-memory-vault.md` — the vault's design
- `vault/lib/vault.ts` — `LINE_BUDGET`, `budgetFindings`, `lintVault`
- `b089def` — the rollback fix that this spec's Consequences section cites
