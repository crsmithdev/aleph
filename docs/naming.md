# Naming

This page is the standard for the names, IDs and status words that aleph shows and stores. `lib/naming.ts` owns every set and format on this page. No other file defines an ID pattern, a state list or an event phrase.

## Terms

| Term | Definition |
|---|---|
| Project | A repo in `~/.aleph/repos.json`. It has a unique `code` of 1 or 2 lower-case letters. |
| Issue | One record in the work store: title, spec, status, priority and links. |
| Link | A relation between two issues: `from` (split from), `after` or `related`. A hierarchy is a link, never part of an ID. |
| Routine | Work with no issue, from a fixed list in code: `monitor`, which runs on a schedule, and `chat`, one turn of the UI chat agent. |
| Subject | What a job works on: an issue or a routine. |
| Job | One attempt that the factory starts on a subject. It has a folder, a log, a cost and a state. |
| Work state | The factory's state for one issue: branch, worktree, next step. It is stored in `~/.aleph/jobs/<issue>.json`. |

Text that people read does not use these old words: goal (an issue), part (an issue with a `from` link), run (a job), kind (an internal field of a job).

## IDs

| Thing | Form | Example |
|---|---|---|
| Project | `<code>` | `a` |
| Issue | `<code><n>` | `a1430` |
| Old part | `<code><n>.<k>` | `a1359.1` |
| Job | `<subject>#<n>`, numbered from 1 in start order | `a1430#2`, `monitor#14` |
| Commit | short sha | `4240d76` |

- The page, the CLI output and `aleph report` show the short form. Every command accepts the short and the full form.
- Stored text with no repo context keeps the full form `aleph-1430`: issue files, the `Issue:` trailer, the vault, notes and cross-repo references.
- A short ID is never read out of free text. `a1430` is valid hex, so a sha such as `a143077` would match. Only the full form is found in free text.
- A sub-issue takes the next number from the repo's counter and gets a `from:` link. The parent stays open and closes when its children close.
- Old dotted parts keep their IDs and still parse.
- A file or unit name uses `-` in place of `#`, with the subject in the full form: run folder `20261105-080726-aleph-1430-2`, unit `aleph-aleph-1430-2`. A run keeps its `n`. A run from before job IDs has none, so its `n` is its place in start order among the runs on its subject.
- The `Job:` commit trailer is the job ID of the job's first run: `Job: a1430#2`. A commit from before job IDs has the run folder's name, and the search for a job's commits finds both.

## Events

Every event has these fields: a log row, a job's end, a Status card line, a report line. A writer stores the fields. Only the display joins them. A log event is one line of the event log, `factory/events/<day>.jsonl`: the event as JSON, in the file of its UTC day, which `logEvent` in `jobs/lib/infra/layout.ts` writes. A day before today never changes, so a reader reads only the days of its window (`readEvents`). Each write that changes a run's state logs one event by `gate` on the run's subject, with the state as the action and the job ID in `on`; an event of a run that ends has its `cost`, and one of a run that lands its `commit`. An Ask set logs `question` and an Ask cleared logs `answered`, on the record's key. `add` logs `filed` and `close` logs `done` or `dropped`, on the issue's full ID. A gate hold logs its event when it writes a new hold, and also keeps it in the job record.

| Field | Form | Example |
|---|---|---|
| `by` | an actor | `gate` |
| `subject` | an ID | `aleph-1420` |
| `action` | one word from `ACTIONS` | `busy` |
| `sub` | one word from `SUBS`, optional | `error` |
| `on` | IDs | `aleph-1372` |
| `file` | a path | `ui/views/issues.js` |
| `count` | `<n> / <limit or window>` | `3 / 1h` |
| `result` | the state of the `on` job | `dropped` |
| `to` | who decides next: `human` or `director` | `director` |
| `cost` | dollars of the run that ended, number | `1.5` |
| `commit` | the commit a landed run made | `abc1234` |
| `note` | free text | |

The content is the fields after `sub`, joined by a space. `→` comes before `result`, `file` and `to`. A file that a `to` follows, with no `on` before it, takes the `to`'s arrow and has no arrow of its own (`docclaims.ts → human`). A file with no other field before it and no `to` after it still takes an arrow (`→ tests`):

```
gate      a1421  running              a1421#6
rule      a1421  reran     rescue     a1421#6 → dropped
director  a1375  landed    override   ▸ note
gate      a1420  busy                 a1372 → issues.js
director  a1417  escalated protected  docclaims.ts → human
gate      a1372  looping   starts     3 / 1h
```

- A value is one lower-case word. A value has no `·`, `;` or `:`, and no sentence.
- A note shows only when its row opens.
- Sentences stay in notes, Ask case text, health lines, and empty or error states. Their IDs and files still take the short form.

## Word sets

Every value is lower case, in storage and on the page. A word means one thing in every set. A set is stored, or it is derived from the stored sets and adds no words.

| Set | Stored | Values |
|---|---|---|
| Issue status | yes | open, parked, done, dropped |
| Job state | yes | running, waiting, passed, returned, failed, landed, dropped, done |
| Action | yes | the job states; paused, red, after, full, gpu, busy, looping, starting, parent, parked, credit, protected, question, incomplete, capped, proposal; reran, filed, escalated, changed, answered |
| Sub | yes | no-commit, timeout, stalled, infra, locked, credit, check, conflict, moved, review, unanswered, duplicate, met, manual, protected, question, intake, capped, override, error, rescue, local, starts, other |
| Actor | yes | human, rule, gate, worker, reviewer, check, intake, director, monitor, firefighter |
| Kind | yes, never shown | build, recheck, land, intake, director, monitor, chat |
| Stage | derived | new, queued, held, working, waiting, failed, landing, done, dropped, parked |
| Report lane | derived | landed, waiting, failed, other |
| Flow class | derived | landed, returned, failed, reran, dropped |

`done` is a job that ended with no land: an intake, director, monitor or chat job. `returned` is a job that a reviewer or a check sent back. `failed` is a job that broke.

### Old words

A writer writes only the new words. A one-time migration (`jobs/lib/records/migrate.ts`, run by the tick) rewrote the old words of the job records and the event log, so a reader reads the stored words as they are. `OLD` in `lib/naming.ts` keeps the ask, gate, actor and act maps that live code still uses; the migration owns the others.

| Set | Old → new |
|---|---|
| Job state | awaiting, needs-you → waiting; stuck → returned (sent back) or failed |
| Cause | time-box → timeout; lock-busy → locked; reviewer → review; no-answer → unanswered; own-list → other |
| Fate | already-met → met; by-hand → manual |
| Review call | land → passed; back → returned; ask → waiting; pending → running; error → failed |
| Ask reason | held-path → protected; review → returned; no-commit → failed; part-dropped → incomplete; intake-failed → failed; rescue → waiting; run-cap → capped; proposal-* → proposal |
| Gate | pause → paused; baseline → red; live-cap → full; busy-file → busy; loop-guard → looping; credit-wait → credit |
| Actor | You → human; Rule → rule; Gate → gate; Director → director; Firefighter → firefighter; triage, planner → intake |
| Kind | agent → build; triage, plan → intake; explain → director; firefighter → director; facts stays, since readers tell it from the job's real runs |
| Log act | land → landed; drop, drop-issue, decline → dropped; rerun, retry → reran; add, approve → filed; answer, recommended → answered; close → done; edit-goal → changed |
