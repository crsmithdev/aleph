# Memory vault

Decided 2026-09-04 in a grill-me session. Replaces the retired vector memory
MCP server with an Obsidian vault the agent owns and Chris can read.

## Problem Statement

What the agent learns is lost between sessions or stranded where nobody
reads it: the vector store held 207 auto-extracted session stubs nobody
opened; Langfuse records what happened, not what was learned; plans,
handoffs, sketches and the harness's per-project auto-memory do not
cross-reference. "What do I know about Langfuse ingestion" is answered by
grep luck. A fact true in August is still asserted in September because
nothing supersedes anything.

## Solution

A git repository at `~/.aleph/vault` in standard Obsidian conventions: notes
are markdown files named by title, linked with `[[Title]]`, typed by
frontmatter, filed by kind. The agent writes a note when it learns how
something behaves, decides something, or is corrected; it rewrites rather
than appends and marks what a note supersedes. A `Home.md` map and a
`MEMORY.md` standing-context file are injected at session start. A Bun
script does the mechanical parts (validation, lint, daily log, commit) and a
skill holds the judgment. Chris opens the vault in Obsidian, reads what the
agent believes, and corrects it in place.

## User Stories

1. As the agent, I want a deterministic place for each kind of note, so that I never infer where something belongs.
2. As the agent, I want `Home.md` and `MEMORY.md` in context at session start, so that I read before I re-derive.
3. As the agent, I want to write a note in one command that validates, logs, and commits, so that a write is never half done.
4. As the agent, I want to mark a note as superseding another, so that the vault rewrites instead of accreting.
5. As the agent, I want a write refused when it would break the structure, so that the vault cannot drift silently.
6. As the agent, I want warnings for orphans, stale claims and likely contradictions, so that I can fix them with judgment.
7. As the agent, I want a recall command that finds notes by title, alias, then body, so that search has one shape.
8. As the agent, I want a compile command that digests a day's traces, handoffs and daily note, so that I can propose what judgment missed.
9. As the agent, I want the contract file protected from my own edits, so that the rules I run under are stable within a session.
10. As Chris, I want the vault to open in Obsidian with daily notes, attachments and links working, so that I read and edit it like any vault.
11. As Chris, I want my Obsidian edits and the agent's writes distinguishable in git, so that blame answers who said what.
12. As Chris, I want `MEMORY.md` to hold standing context about me and my environment, so that the deleted identity imports have a successor.
13. As Chris, I want every write to be one commit with a readable message, so that `git log` is the change log.
14. As Chris, I want compile to show me a list of proposed notes before anything is written, so that automation never commits unreviewed content.
15. As Chris, I want the agent told once, in the identity, when to write, so that no hook extracts facts.
16. As Chris, I want the vault to stay local, so that personal data is not pushed anywhere by default.
17. As Chris, I want the health of the vault visible on the last line of `Home.md`, so that drift is noticed.
18. As a headless session, I want the same injection and the same script, so that verification runs without a terminal.
19. As the plugin maintainer, I want the vault path overridable by environment, so that tests run against a temp vault.
20. As the plugin maintainer, I want the script tested through its command line only, so that internals can change freely.

## Acceptance Criteria

1. WHEN a note with `kind: gotcha` is written THE script SHALL place it at `wiki/gotchas/<Title>.md`, and likewise for the other four kinds. IF the target folder and `kind` disagree THEN THE script SHALL refuse with exit 1 and name both.
2. WHEN a session starts with the vault present THE SessionStart hook SHALL emit `additionalContext` containing the full text of `Home.md` followed by `MEMORY.md`. IF the vault is absent THEN THE hook SHALL exit 0 with no output.
3. WHEN `vault write <file>` runs on a valid note THE script SHALL write the note, append one line `- HH:MM write [[Title]] — <why>` to `daily/YYYY-MM-DD.md`, set the Home health line, and create one git commit whose subject is `write: <Title>`.
4. WHEN a written note carries `supersedes: [Old]` THE script SHALL move `Old` to `archive/Old.md`, add `archived: <date>` and `archived_reason: superseded by [[Title]]` to its frontmatter, log `supersede [[Old]] → [[Title]]` in the daily note, and commit with subject `supersede: Old → Title`.
5. IF a note is missing any of `kind scope confidence updated supersedes sources` or has a value outside the enum THEN THE script SHALL refuse with exit 1 listing each violation. `aliases` and `tags` may be absent.
5a. IF the title or any alias collides with an existing title or alias THEN THE script SHALL refuse with exit 1 naming the colliding note.
5b. IF the body contains `[[X]]` and no note titled or aliased `X` exists THEN THE script SHALL refuse with exit 1 listing each dangling link.
5c. IF a write would leave `Home.md` or `MEMORY.md` over 150 lines THEN THE script SHALL refuse with exit 1 stating the count.
5d. IF the body lacks a first paragraph beginning `**Claim.**` containing `as of YYYY-MM-DD`, or lacks the sections Details, Evidence, Related THEN THE script SHALL refuse with exit 1.
6. WHEN `vault lint` runs THE script SHALL print, as JSON, every refuse-class finding across the vault plus warnings for: a wiki note not linked from `Home.md`; a `confidence: measured` note whose `updated` is older than 90 days; two notes with the same `scope` whose titles or aliases share two or more words of four or more letters and where neither `supersedes` the other. Exit 1 if any refuse-class finding, else 0.
7. WHEN `vault recall <query>` runs THE script SHALL print matching notes as JSON in order: title equal, alias equal, title or alias containing, body containing; each with path and frontmatter. WHEN nothing matches THE script SHALL print `[]` and exit 0.
8. WHEN `vault compile <date>` runs THE script SHALL fetch traces whose timestamp falls on that date from Langfuse, their observations, handoff files whose name starts with the date, and `daily/<date>.md`, and print a digest with one block per turn (cwd, final message, guardrail verdict and reason, commands run) capped at 12 KB, followed by the list of trace ids already cited in any note's `sources`. IF Langfuse is unreachable THEN THE script SHALL print the handoff and daily parts, note the failure in the digest, and exit 0.
9. WHEN an Edit or Write tool call targets `VAULT.md` in the vault THE git-guard hook SHALL deny with a reason pointing at `wiki/decisions/`. WHEN an Edit or Write targets any other path in the vault THE git-guard hook SHALL allow it although the vault is on `main`.
10. WHEN the vault is opened in Obsidian THE committed `.obsidian/` SHALL set the daily-notes folder to `daily/` with format `YYYY-MM-DD`, the attachment folder to `attachments/`, and wikilinks on. `workspace*.json` and `plugins/*/main.js` are gitignored.
11. WHEN the script commits THE commit SHALL carry the `Co-Authored-By: Claude` trailer. A commit made by hand from Obsidian or the shell has no trailer.
12. WHEN the vault is initialised THE `MEMORY.md` SHALL contain the profile, environment, tech stack, project context and commit conventions from the USER.md backup, rewritten, under 150 lines.
13. WHEN two writes happen in one session THE vault SHALL have two commits, one per write.
14. WHEN compile is invoked from the skill THE agent SHALL present titles and one-line claims and wait for approval before any `vault write` runs.
15. WHEN the identity is read THE identity SHALL contain exactly one memory rule: write the page when you learn how something actually behaves, decide something, or get corrected; read Home and MEMORY before deriving; search only after.
16. WHEN the vault is created THE repository SHALL have no remote. The script never pushes.
17. WHEN any write or lint completes THE last line of `Home.md` SHALL read `Health: <n> notes, <d> dangling, <o> orphans, lint <YYYY-MM-DD>`.
18. WHEN `claude -p` runs with `CLAUDECODE` unset and the plugin loaded THE session SHALL receive the same `additionalContext` as an interactive session.
19. WHEN `ALEPH_VAULT` is set THE script and the hook SHALL use that path instead of `~/.aleph/vault`.
20. WHEN `bun test` runs THE suite SHALL exercise the script only by spawning it with argv and environment, and the hook only by stdin and stdout.

## Implementation Decisions

**Vault layout.** `VAULT.md` (contract, human-owned), `Home.md` (agent-maintained
Map of Content, one line per note grouped by kind, health line last),
`MEMORY.md` (standing context, agent-writable), `wiki/{decisions,concepts,
entities,projects,gotchas}/`, `daily/`, `archive/` (flat), `attachments/`,
`.obsidian/`. Rejected: flat `wiki/` with `kind` as the only classifier
(non-deterministic write path); `inbox/`, `research/`, `human/` from the
August contract (daemon and sandbox artefacts); a generated `index.md`.

**Naming.** Filename is the title, Title Case, unique across titles and
aliases, no `/ \ : * ? " < > |`. Links are bare `[[Title]]`. Rejected:
kebab filenames with `title:` frontmatter, which need piped aliases on every
link.

**Frontmatter.**

```yaml
aliases: []                       # optional
kind: decision|concept|entity|project|gotcha
scope: <repo basename>|global
confidence: measured|reported|inferred
updated: YYYY-MM-DD
supersedes: []                    # titles
sources: []                       # trace:<id>, path, chris, URL
tags: []                          # optional, Chris's
```

`title` is not a field. `kind` duplicates the folder on purpose so a stray
move is detectable.

**Body.** One template for all kinds: a first paragraph `**Claim.** … as of
<date>.`, then `## Details`, `## Evidence`, `## Related`. Rejected: per-kind
templates.

**Ownership.** `VAULT.md` human-owned, enforced by git-guard. `MEMORY.md` and
everything else agent-writable. Rewrite sections, never append, except the
daily note which is append-only and today-only.

**Script.** One Bun entry point in the plugin with subcommands `write`,
`recall`, `lint`, `compile`. Vault path from `ALEPH_VAULT`, default
`~/.aleph/vault`. Output JSON on stdout, findings on stderr, exit 1 on
refusal. `write` is atomic: validate everything, then write, log, update
health, commit; nothing lands on refusal. Rejected: prose-only skill (every
mechanical step re-derived per session, misses silent).

**Skill.** `/aleph:vault` holds the judgment: when a learning is worth a
page, which kind, what the claim is, how to run compile's approval step.
It calls the script for everything mechanical.

**Hook.** A new synchronous SessionStart command hook, separate from the
async observability hook whose stdout the harness ignores. It prints
`additionalContext` with `Home.md` then `MEMORY.md`, whole. No scope filter
in v1. Rejected: injecting `VAULT.md` too (its rules live in the skill and
identity); filtering Home by cwd (a moving part for a ≤150-line file).

**git-guard.** Add a clause: paths under the vault are allowed on `main`
except `VAULT.md`, which is denied with a reason pointing at
`wiki/decisions/`.

**Lint classes.** Refuse: schema, duplicate title or alias, dangling link,
folder/kind mismatch, Home or MEMORY over 150 lines, body template. Warn:
orphan, stale measured (90 days), same-scope overlap without supersedes.
Rejected: a judge pass for contradictions (added later as `lint --deep` if
overlap misses too much); warn-everything.

**Compile.** On demand. Inputs: Langfuse traces for the date via the public
API with the keys from `~/.aleph/.env`, handoff files for the date, the
daily note, and every `sources` entry already in the vault. Output: a
digest the agent turns into proposed writes; the agent lists titles and
claims; Chris approves; writes run and commit one each. Scheduling comes
after three consecutive unedited acceptances. Rejected: nightly from day
one; handoffs-only.

**Writers.** Agent judgment under one identity rule, compile as the safety
net. No extraction hook, no Stop-time nudge. The harness auto-memory is left
in place; the rule sends new learnings to the vault.

**Seed.** No wiki pages. `MEMORY.md` from the USER.md backup, rewritten.
The retired SQLite stays at its path, unread.

**Git.** Own repo, local only, `main`, one commit per write with the plugin's
trailer. `.obsidian/` committed minus `workspace*.json` and plugin
`main.js`; `attachments/` committed.

**Obsidian.** Daily Notes core plugin on, folder `daily/`, format
`YYYY-MM-DD`; attachment folder `attachments/`; wikilinks on; new notes at
vault root so a note written from Obsidian is caught by lint as unfiled.

## Testing Decisions

A good test drives the script by argv and environment against a temp
git-initialised vault and asserts exit code, stdout JSON, files on disk and
`git log`. Nothing tests an internal function. Fixtures are a minimal valid
vault (contract, Home, MEMORY, one note per kind) built in `beforeAll`.

Seams:

- Script CLI: every acceptance criterion numbered 1, 3–8, 13, 17, 19.
- SessionStart hook stdin/stdout: criteria 2, 19.
- git-guard stdin/stdout with a temp vault: criterion 9.
- Compile against a stub Langfuse server on port 0, as the observability
  hook test does today: criterion 8.
- Live, gated by `ALEPH_LIVE=1`: two headless `claude -p` sessions with
  `CLAUDECODE` unset; the first writes a note, the second reports the
  title from its injected Home: criteria 18, 15 by inspection.

Prior art: the hooks test spawns each script with a JSON payload and a
temp spool, and captures OTLP posts with an in-process `Bun.serve`; the
live Langfuse test polls the public API until a span appears.

## Out of Scope

- Scope-filtered injection.
- Scheduled compile.
- A judge pass for contradictions.
- Migrating the harness auto-memory folders or the retired SQLite.
- A remote for the vault.
- Syncthing, phone sync, sandboxes, read-only mounts.
- Embeddings or any search beyond title, alias and body match.
- Per-kind body templates.
- Editing `VAULT.md` by the agent.

## Open Questions

None blocking. Deferred, each with its unblock:

- Scheduling compile: three consecutive unedited acceptances.
- `lint --deep` judge: overlap lint misses a contradiction that mattered.
- Scope filtering of Home: Home approaches 150 lines.
- Auto-memory migration: the write op exists and compile has been run once by hand.

## Further Notes

The August contract at the daemon-era vault is the ancestor of `VAULT.md`;
it is this repo's own lineage and may be trimmed, not rewritten. Nothing from
the old construct is carried in. The `verified` score and the verify gate's
"what was run and observed" sentence are the raw material compile mines;
the vault does not add its own hooks beyond the SessionStart injection.
