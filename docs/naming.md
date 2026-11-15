# Naming

This page is the standard for the names, keys and status words that aleph shows and stores. `lib/naming.ts` owns every set and format on this page. No other file defines a key pattern, a state list or an event phrase. The plan is `docs/specs/2026-11-14-storage-ids.md`.

## Terms

| Term | Definition |
|---|---|
| Project | A repo that aleph works on. It has a unique `code` of 1 or 2 lower-case letters. |
| Issue | One request in the work store: title, spec, status, priority and links. |
| Idea | A note of something to build, with its lens results. |
| Job | One execution: an intake, build, review, land, recheck, lens, monitor, housekeeper, maintainer or plain run. It has a role, a state, a cost and a folder. |
| Role | What a job does. A job has one role. |
| Link | A relation between two stored things. A job has `target`, `prev` and `retry_of`. An issue has `from`, `after` and `related`. A hierarchy is a link, never part of a key. |
| Issue state | The live machine state of one issue: its Ask, its wait and its CI result. It outlives each job on the issue. |
| Event | One sentence of 6 fields that says who did what to which thing. |
| Subject | Who acted in an event. |
| Object | The thing an event acted on. |
| Detail | The free text of an event: the reason, a file, a count. |

Text that people read does not use these old words: goal (an issue), part (an issue with a `from` link), run (a job), routine (a job with a role), kind (of a job: say role).

## Keys

A stored thing has one key, `<kind>.<n>`, with one counter per kind. A key never encodes another thing. `key`, `parseKey` and `shownKey` in `lib/naming.ts` build, read and show it.

| Kind | Key | Shown as |
|---|---|---|
| Project | `project.3` | `p-00003` |
| Issue | `issue.2072` | `i-02072`, or `a-02072` with the project code `a` |
| Idea | `idea.7` | `d-00007` |
| Job | `job.6802` | `j-06802` |

- The shown form pads the number to 5 digits and is for display only. A stored key is never padded. The parser reads a shown form and a number with leading zeros, so a copied `j-06802` resolves.
- The kind letters of the shown form are lower case, `p`, `i`, `d` and `j`. A project code is lower case too, so no project takes the code `p`, `d` or `j`. A shown key is never stored.
- A commit trailer is `Issue: issue.<n>` or `Job: job.<n>`.
- A sub-issue is an issue with a `from` link. The parent stays open and closes when its children close.

### Old IDs

Code that the plan has not reached still writes the old forms: the issue ID `aleph-1430` (short `a1430`, old part `a1359.1`), the job ID `a1430#2` or `monitor#14`, and `-` in place of `#` in file and unit names. `parseId`, `parseJob`, `setCodes` and `FULL` in `lib/naming.ts` read them. An old job ID is text that identifies one run, not a key. An event may hold one as its object until the migration rekeys it. A short ID is never read out of free text, because `a1430` is valid hex.

## Model: Work tracking

- **Issue**
  - Identity: `issue.<n>`. One counter covers every project. The counter never falls below the highest issue folder.
  - Lifecycle: open, parked, done, dropped. The status is derived from the stored `closed_as` and `parked` fields. Any move is allowed. A close clears `parked`. A trailer commit on main never sets it: done is the stored status; the sweep closes an issue whose work is on main and reopens one whose commits are all reverted.
  - Owner: the work store. One door files a new issue. Every close logs `done` or `dropped`.
  - Invariants: each new issue logs one `filed` event. A part of a parked parent is not buildable. An `after` link to a dropped issue parks the waiter and asks.
  - Relations: one project. Many links. Many jobs, through the `target` column of each job. At most one issue state.
- **Job**
  - Identity: `job.<n>`, in start order. A job covers one execution, so a build, its fix round and its land are three jobs. A migrated job keeps its old key in a `was` column, for search only.
  - Lifecycle: the state is a word from the job states. Two writers set it: `setState`, and `endRun`, which writes the state, the end and `next` in one transaction and logs the event like `setState`. A job is open while it is running, passed, waiting, returned or failed.
  - Owner: one creator, `makeJob`. The row is in `aleph.db`. The files are in `jobs/<n>/`.
  - Invariants: the links are columns: `target` (its issue, project or idea), `prev` (the step before it) and `retry_of` (the job it redoes). Each has at most one target. A job has its role, its cost, its model and its commit on its row.
  - Relations: at most one target. At most one `prev`. At most one `retry_of`. Many events name it as subject or object.
- **Event**
  - Identity: `seq`, a counter that gives the order. A row in the `events` table of `aleph.db`.
  - Lifecycle: append only.
  - Owner: one door, `logEvent` in `lib/layout.ts`, which checks the words through `event()` in `lib/naming.ts`. Readers read the view `event_rows`, which adds the role, target, project, model, tier, cost, commit and times of the job on each side.
  - Invariants: `subject` is a job key or one of `gate`, `rule`, `human`, `claude`. `action` is in the action set. `object` is a key, or `settings` for a settings event.
  - Relations: one subject. One object. Record events (`hold`, `started`, `streak`, `cap`, `rerun`, `rescued`, `director`) are events with the issue or job as object.
- **Issue state**
  - Identity: the issue key. A row exists only while something is live.
  - Lifecycle: set when an Ask, a wait or a CI result starts. Deleted when none is live.
  - Owner: `aleph.db`. It holds `ask`, `ask_job`, the wait (`wait_kind`, `wait_reason`, `wait_since`) and `ci`.
  - Invariants: at most one Ask per issue. The Ask history is in the events (`question` and `answered`).
  - Relations: one issue. At most one job, the one that asked.

## Events

Every event has 6 fields: a log row, a job's end, a Status card line, a report line. A writer stores the fields. Only the display joins them.

| Field | Form | Example |
|---|---|---|
| `seq` | a number that gives the order | `6841` |
| `time` | ISO UTC time | `2026-11-14T10:12:03.511Z` |
| `subject` | a job key, or one of `gate`, `rule`, `human`, `claude` | `job.6802` |
| `action` | one word from `ACTIONS` | `returned` |
| `object` | a key, or `settings` | `issue.2072` |
| `detail` | free text: the reason, a file, a count | `a check failed` |

- The subject is the job key when an agent run acted. The page shows the role of that job and links it. `gate` and `rule` are code, `human` is Chris, and `claude` is an interactive session or the UI chat.
- A run's state change is one event by `gate` on the job. A returned job that the reviewer sent back has the reviewer's job as subject, and the sentence reads "returned by review".
- An Ask set logs `question` and an Ask cleared logs `answered`. Each new issue logs `filed`. Each close logs `done` or `dropped`.
- A change of a setting (pause, resume, an Always rule, a model tier, the judge) logs `changed` on object `settings`.
- A `vault write` that the contradiction screen refuses logs no event.
- Keys and paths in the detail are linked by the page: every `(project|issue|idea|job).<n>` and each old issue ID.
- The detail of a cause is its phrase from `because` in `lib/naming.ts`: `timeout` is "past its time box", `override` is "over review".

The sentence of an event comes from its action. `say()` in `lib/naming.ts` fills the template with the object, the subject in words and the detail.

| Action | Sentence |
|---|---|
| `running` | `job.6802` started |
| `landed` | `job.6802` landed: over review |
| `returned` | `job.6802` returned by review |
| `waiting` | `issue.2072` waits for you |
| `after` | `issue.2072` waits for `issue.2071` |
| `busy` | `issue.2072` waits: `job.6802` holds `lib/naming.ts` |
| `red` | `issue.2072` waits: main is red: at abc1234 |
| `filed` | `issue.2072` filed by you |
| `answered` | `issue.2072` answered by the director |
| `stalled` | `job.6802` stalled |

The detail follows the sentence after a colon. `after` and `busy` take the detail in place.

## Word sets

Every value is lower case, in storage and on the page. A word means one thing in every set. A set is stored, or it is derived from the stored sets and adds no words. `lib/naming.ts` defines each set once, and the types `State`, `StageName` and `Role` derive from it.

| Set | Stored | Values |
|---|---|---|
| Issue status | yes | open, parked, done, dropped |
| Issue kind | yes | task, bug, check, flake |
| Job state | yes | running, waiting, passed, returned, failed, landed, dropped, done |
| Action | yes | the job states; paused, red, after, full, gpu, busy, looping, starting, parent, parked, credit, protected, question, incomplete, capped, proposal; reran, started, missed, skipped, filed, escalated, changed, answered, routed, stalled, reopened |
| Subject | yes | gate, rule, human, claude; worker, reviewer, check, intake, director, monitor, firefighter |
| Ask reason | yes | held-path, review-held, question, no-commit, part-dropped, intake-failed, rescue, run-cap, core-change, blocker-dropped, proposal-check, proposal-claude-md, proposal-skill |
| Role | yes, never shown | build, plain, land, review, intake, recheck, director, monitor, lens, housekeeper, maintainer |
| Stage | derived | new, queued, held, working, waiting, failed, landing, done, dropped, parked |
| Report lane | derived | landed, waiting, failed, other |
| Flow class | derived | landed, returned, failed, reran, dropped |

An issue kind is `task` (any work), `bug` (something broken), `check` (a manual check after a land) or `flake` (a flaky-test sighting, noted on the tracker and never built).

`done` is a job that ended with no land: an intake, director, monitor, review or plain job. `returned` is a job that a reviewer or a check sent back. `failed` is a job that broke. `stalled` is a job that wrote no output for its stall time. The last six subjects of the Subject row are role words of events written before jobs had keys: code reads them and writes only `gate`, `rule`, `human`, `claude` and job keys, except where live code still names a role.

### Old words

A writer writes only the new words, and a reader reads the stored words as they are. `OLD` in `lib/naming.ts` keeps the ask, gate, actor and act maps that live code still uses. The migration of the storage plan rewrites the old words and then removes the maps.

| Set | Old → new |
|---|---|
| Job state | awaiting, needs-you → waiting; stuck → returned (sent back) or failed |
| Cause | time-box → timeout; lock-busy → locked; reviewer → review; no-answer → unanswered; own-list → other |
| Fate | already-met → met; by-hand → manual |
| Review call | land → passed; back → returned; ask → waiting; pending → running; error → failed |
| Gate | pause → paused; baseline → red; live-cap → full; busy-file → busy; loop-guard → looping; credit-wait → credit |
| Actor | You → human; Rule → rule; Gate → gate; Director → director; Firefighter → firefighter; triage, planner → intake |
| Kind | agent → build; triage, plan → intake; explain → director; firefighter → director; facts stays, since readers tell it from the job's real runs |
| Log act | land → landed; drop, drop-issue, decline → dropped; rerun, retry → reran; add, approve → filed; answer, recommended → answered; close → done; edit-goal → changed |
