# The vault at scale

Written 2026-09-24, after `lint --fix` cleared the backlog and the numbers
underneath were worse than the backlog. Built.

## Problem Statement

The vault is 20 days old and already at its ceiling.

| Measure | Value |
| --- | --- |
| notes | 138, every one entered in 2026-09 — about 7 a day |
| Home.md | 132 index lines of a 150-line budget; 91 of them point at gotchas |
| kinds | 98 gotcha, 20 decision, 14 project, 3 concept/entity |
| archived in 20 days | 2 |
| overlap warnings | 147, across 62 of 138 notes |
| stale warnings | 0, and the rule had never fired |

Published practice puts the index pattern's limit at 100-200 pages, where the
index stops fitting in one read. At seven notes a day Home had weeks left, and
raising `LINE_BUDGET` buys one of them.

Three rules were dead or lying. `stale` read `measured` notes older than 90
days, on a vault where nothing was older than 30. `overlap` pairs notes on
words their titles and aliases share inside one scope, and the scope already
encodes the project name, so it fired 147 times and named nothing worth doing.
`orphan` demanded a Home line for all 138 notes, which is what made Home an
inventory.

`supersedes` was the only exit, and it needs a newer note covering the same
ground. A subject that is simply over has no such note, so nothing left.

## Solution

### Home routes; `recall` finds

`HOME_KINDS` is decision, project, concept, entity. A gotcha is what you search
for when you hit it, not what you need in context every session. `orphan` now
applies only to the kinds Home carries.

### `vault consolidate`

Read-only. `--apply` writes. It rebuilds Home as a router, drops index lines
that point at nothing, at an archived note, or at a gotcha, and reports what it
will not do: notes that want a Home line, claims past their window, and bodies
that say "yesterday" instead of a date.

It writes no index line. A hook is prose about what a note is for, so a missing
one is reported for a person to write; an invented hook is a claim nobody made.

The consolidation passes that ship elsewhere run unattended with no dry run and
no approval. This vault has already lost notes to an op that reached past its
own paths, so the default prints and changes nothing.

### Decay per kind, widened by confidence, reset by use

| kind | base | x measured 1.5 | x reported 1 | x inferred 0.5 |
| --- | --- | --- | --- | --- |
| project | 30 | 45 | 30 | 15 |
| gotcha | 60 | 90 | 60 | 30 |
| decision | 180 | 270 | 180 | 90 |
| concept, entity | 365 | 548 | 365 | 183 |

A decision decays slowly and a transient gotcha decays fast; a project note
describes current state, so it decays fastest. Freshness and authority are
different axes, and the old rule collapsed them: it only ever looked at
`measured`, which is the evidence that ages best.

The window runs from the later of `updated` and the last time `recall` returned
the note. A retention curve resets on use, and `updated` only moves when
someone rewrites a note, so a page read every week looked as stale as one
nobody had opened. `recall` records the hit in `.recall.json`, which is
gitignored: a read is not a change to memory, and losing the file only costs
the reset.

### `vault archive <title> --why`

An exit that needs no replacement note. The file moves to `archive/` with an
`archived_reason`, its Home line goes, and every wiki note that links to it is
named. Archive is not deletion, so VAULT.md's rule holds; an archived note
stays a link target and nothing dangles.

`lint` warns on both halves of the git/disk gap: a wiki note git tracks that is
gone from disk, named with `archive`, and a note on disk git has never seen,
named with `write`. On 2026-09-26 seven drafts another session had left in the
live vault were waiting, and nothing had said so. Deleting a note in Obsidian used to be swept into the
next commit; now no op touches it, so something has to say it happened.

### `vault adopt <path> --why`

`write` gates new prose and refuses on the template; `lint` treats the template
as a warning, because a note on disk cannot be un-written. A draft written
straight into `wiki/` is both at once, so there was no door: `write` refused it
and no other op would commit it. Five notes were stranded in the live vault on
2026-09-26 for exactly that reason.

Adopt applies every schema, folder, duplicate and dangling refusal and demotes
the template to a warning. It does not edit the note. An `## Evidence` heading
nobody wrote would turn "this claim is unbacked" into a passing check, which is
the same reason `lint --fix` never touches a body.

### `vault rename-scope <old> <new>`

`scope` is free text, and a rename moves the repo and leaves every note behind,
so the vault collected five names for two projects across 49 notes:
`voice-bridge` and `voice-bridge-mcp` are both Sidetone (`~/voice-bridge-mcp`
is the voice bridge repo, per [[Voice Bridge MCP]]), and `caller` is Voiceover.
Nothing caught it, because the only rule that read `scope` was the overlap
check, now off.

Read-only unless `--apply`. It rewrites the `scope:` line and nothing else, one
commit for the batch, and refuses a scope no note has — a misspelling is the
likelier reading than a new project.

### `overlap` is off

Kept behind `lint --overlap`. It pairs notes on the project name, which the
scope already encodes, and dated series pair with each other by design. Word
overlap also cannot see the failure that matters, a later note that quietly
invalidates an earlier one. Published work on that uses embeddings with fuzzy
matching and still needs a labelled corpus to set a threshold. The code waits
for a rule that finds something.

## Consequences

Home falls from 132 index lines to about 41, so the budget stops binding.

The write rate is the disease: 98 gotchas to 20 decisions says the bar for a
gotcha is too low. The skill now sets one — a gotcha earns a page when the
behaviour cost a debugging session and the next session would pay again — but
a sentence in a skill is not a gate, and nothing measures whether it holds.

Home's health line carries the stale count, because SessionStart injects that
line and nothing else shows a window closing. No hook runs `consolidate`.

Template warnings collapse to a count past one note. 69 correct warnings are a
wall, and the seventieth is the one that matters; `lint --template` names them.

Contradiction detection is still missing. A frontier model scores 55.2% on the
STALE benchmark's implicit conflicts, so this is not a gap to close with a
heuristic. `consolidate` reports the inputs and leaves the judgement.

## Related

- `docs/specs/2026-09-04-memory-vault.md` — the vault's design
- `docs/specs/2026-09-24-vault-prune-and-fix.md` — the commit-scope fix under this
- `vault/lib/vault.ts` — `HOME_KINDS`, `DECAY_DAYS`, `staleness`, `planHome`
