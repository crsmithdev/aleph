# One key per thing: storage, IDs and the migration, then the Herald B2 redesign

This plan supersedes `/home/crsmi/.claude/plans/continue-state-the-latest-cheerful-cookie.md` (same content, plus
the group 2 decisions of 2026-11-14 made consistent).

## Context

The user asked for a design pass on the Herald (`ui/views/now.js`) and chose layout B2 (mocks on `docs/herald-mock`,
vault note "The Herald Is A One-Line Ledger With Guide-Line Folds"). Making its IDs consistent led down to the data
model: IDs were conflated with names, jobs were keyed by issues, machine state was spread over about 40 JSON files,
two git repos and a hand-edited registry, run folders had 12 name formats, and issue files used HTML comment markers.
The user, 2026-11-13 to 2026-11-14: one unique key per stored thing, the storage owns the details, reduce sprawl, and fix
the problems the migration touches ("must go" plus "fits"). Research and benchmarks: vault notes "SQLite Holds
Aleph's Machine State Load With Short Reads", "A Cosmetic Problem Followed Down Ends At The Data Model", "Aleph Links
Are Key Columns Not A Generic Refs Table" and "The Aleph UI Learns Of SQLite Changes From data_version And The Events
Feed". Four red-team reports (2026-11-14) were worked through with the user; their fixes are below.

Two branches, in order:
1. `feature/storage-ids`: storage, IDs, layout, the migration, and the problems it touches. One branch, with a
   rehearsal on a copy before the real run (the user, 2026-11-14), not a JSON-first split.
2. `feature/herald-b2`: the Herald redesign on the new keys.

**What moves:** every stored key, the storage of machine state (into `aleph.db`), the layout of issues, ideas,
projects and jobs, the issue file format, job granularity, and the event shape. **What stays fixed:** the vault, the
work mode, the CLI verbs, the issue numbers of `aleph`, git as the history of documents.

## Decisions

1. **One key rule.** A stored thing's key is `<kind>.<n>`, with one counter per kind. Kinds: `project`, `issue`,
   `idea`, `job`. The separator is `.`. A key never encodes another thing. Things nothing points at need no key.
2. **The path is the key** for files: `items/issues/2072/` is `issue.2072`. Files hold no `id:` and no `was`. Every
   migrated job row keeps its old key in a `was` column, for search only. Old commit trailers are history: no code
   resolves them. The migration scans each repo's old `Issue:` and `Job:` trailers once and stores the landing
   commit in `commit_sha` where the record lacks it (954 of 2,008 archived records hold `commit`). After the
   migration, trailer readers (`jobs/lib/records/status.ts`, `stage.ts`, `jobs/lib/roles/intake.ts`, `jobGrep` in
   `jobs/lib/infra/git.ts`) parse only `Issue: issue.<n>` and `Job: job.<n>`.
3. **Documents in git, records in SQLite, logs as files.**
   - `~/.aleph/items/` is one git repo: what people and agents write as documents. It is `aleph-items` restructured
     in place with `git mv` in one commit, so its 8,786 commits stay and the remote stays `crsmithdev/aleph-items`.
     `aleph-ideas` (5 commits) comes in by a subtree merge and is then archived; `repos.json` becomes `projects/`.
     Contents: 12 projects, about 1,466 issues (1,349 aleph, 127 of them old parts, plus 117 from 9 other
     projects), their 2 media files, and 2 ideas. Dropped from the tree, kept in history: Backlog.md `config.yml`
     (12), `floor.json` and `hidden/` (215 hidden-check folders, retired by the rebuild).
   - `~/.aleph/aleph.db` holds all machine state: jobs, events, counters, tick state, settings, usage logs.
   - `~/.aleph/jobs/<n>/` holds a job's files.
   - `~/.aleph/index.db` is a derived, disposable index over `items/`. Not built now; built when a page needs it.
4. **One job per execution.** Intake, build, review, land, recheck, lens, monitor, housekeeper, maintainer and plain
   runs (`aleph run <name>`) are each a job, with `role` set and a plain run's name kept as a title. The
   derived subject (`subjectOf` in `lib/naming.ts:90`: `on`, else the routine word, else the name) goes, and with
   it bare-word subjects (`housekeeper`) and IDs such as `housekeeper#61`. A job's links are columns on its row:
   `target` (its issue, project or idea), `prev` (the step before it), `retry_of` (the job it redoes). The `runs`
   concept goes.
5. **A chat conversation is a Claude Code session, not a job.** It is keyed by its session ID, like a terminal
   session of the user. The UI server keeps one `claude -p --input-format stream-json` process per open conversation
   and writes each turn to its stdin; after an idle timeout or a restart it starts a new process with
   `--resume <session>`. The transcript is Claude Code's own, cost comes from Langfuse as for terminal sessions, and
   its events have subject `claude`. Pasted images go to `~/.aleph/sessions/<session>/`. The `chat` kind, `openRun`
   for chat and `chatLock` go. Tested 2026-11-14: one process answered two turns with one session and kept the first
   turn. Not yet tested: more than 2 turns, images, an hour idle, Langfuse tracing of a process the server starts.
6. **Links are key columns, not a generic `refs` table.** Each job link has at most one target, so it is a column
   with an index. Document links stay in frontmatter (`from`, `after`, `built`), the source of truth; `aleph.db`
   holds no copy. When a page must query them, `index.db` gets columns for one-to-one links and a join table only
   for many-to-many `after`.
7. **Issues:** one counter across projects. Aleph keeps its numbers; the other projects' 117 issues get numbers from
   aleph's highest plus 1 at migration time (`aleph-2144` exists as of 2026-11-14). The counter never goes below the
   highest `items/issues/<n>/`. Old `<n>.<k>` parts (127) get their own numbers and a `from` link.
8. **Issue file format:** `# Request`, `# Spec` (with `## Goal`, `## Edit surface`, `## Oracle`), `# Notes`, replacing
   HTML comment markers. Notes hold only what people and agents said; code writes no notes.
9. **An event is a sentence of 6 fields:** `seq`, `time`, `subject` (who acted), `action` (the verb), `object` (the
   thing acted on), `detail` (free text: the reason, a file, a count).
   - `subject`: the job key when an agent run acted (`job.6802`; the UI shows its `role` and links the
     job), `gate` or `rule` for code, `human` for the user, `claude` for an interactive session or the UI chat.
     Migrated events keep their role words (`worker`, `director`, `intake`, `firefighter`).
   - `object`: always a key, except `settings` for settings events (tentative). Examples: `gate returned job.6802`
     (the issue is the job's `target`), `rule started issue.2072`, `job.6802 escalated issue.2072`,
     `human paused settings`.
   - Dropped: `on`, `cost`, `commit`, `result`, `tally`, `changes` (the job row holds them); `tier`, `model`, `p`
     (retired routing); `to` (always `human`); `sub` (only display read it); `file`, `count` (into `detail`).
   - What the dropped fields did, and what does it now:
     | Was | Now |
     |---|---|
     | `cost`, `commit`, `model`, duration on a job event (Herald `ui/views/now.js:241`, gates table) | one SQL view, `event_rows`: `events` left-joined to `jobs` on `object` and on `subject`, giving each side's `role`, `target`, `project`, `model`, `tier`, `cost`, `commit_sha`, `started`, `ended`. Every event reader reads the view. |
     | `on`: the job's issue, for Herald folds and links (`now.js:179`) | the view's `object_target` |
     | `?project=` filter of `/api/events` (subject `aleph-N` named the project) | a `project` column on `jobs`, set at creation from the run's repo; for an issue object, the issue-to-project map the server already loads from `items/` |
     | `returned.review`, `waiting.review` sentences ("returned by review") | the sentence reads the subject's `role` from the view: subject `job.6803` of role `review` gives "job.6802 returned by review" |
     | `landed.override`, `waiting.rescue` | the reason text in `detail`: "landed: over review" |
     | `waiting.to` ("waits for you") | `to` was always `human`: `waiting` reads "waits for you" |
     | `{on}` and `{file}` in `red`, `after`, `busy` ("job.6802 holds src/x.ts") | keys and paths written in `detail`; the renderer links every `(project\|issue\|idea\|job).<n>` in `detail`, as `ui/views/gates.js:193` links IDs today |
     | `tally`, `changes`, multi-key `on` of a housekeeper `done` | `tally` in the job's `extra`; each applied change already logs its own issue event through the issue verbs (`docs/naming.md`), so "N changes" counts the events whose subject is the job |
     | `sub` as a fixed word | nothing reads it as a word today; counts by cause come from the job's `cause` |
   - Nothing that a page shows today is lost. Check during step 2: that each housekeeper change logs an issue event.
   - The vault `refused` event (`vault/lib/ops.ts:234`, no reader, 1 in the log) and the `refused` action go.
10. **Settings changes are logged** as events with object `settings` (pause, resume, Always, model tiers, the judge),
    so the Herald shows them and the UI change signal fires.
11. **The job record goes; per-issue machine state gets a table.** Today one `JobRecord` per issue
    (`jobs/lib/records/record.ts:30`) holds runs, the Ask, the wait, `rounds`, `cost`, record events and `ci`. In
    the new model:
    - runs are job rows; `rounds` and `cost` are queries over the jobs with that `target`;
    - `ask`, `askRun`, `wait` and `ci` go to `issue_state` (one row per issue with live machine state), because they
      outlive each job (findings 2026-11-13, draft decision "Job Records Are Keyed By Issue");
    - the `asks` history is already in the log (`question` and `answered` events), so it is not kept twice;
    - record events (`hold`, `started`, `streak`, `cap`, `rerun`, `asked`, `rescued`, `director`) merge into
      `events` with the issue or job as `object`. The findings kept them apart because the log was split by day
      files; with an index on `(object, seq)`, `next()` (`jobs/lib/records/record.ts:351`) reads them per issue
      in one query. A record event whose `data` code reads (check `lastEvent` callers, `record.ts:302`) puts it
      in `issue_state` instead.
12. **One door per write, from the findings' two-writer cases** (`docs/findings/2026-11-13-domain-model-work-tracking.md`):
    - every issue close logs `done` or `dropped`: `store.close` (`issues/lib/store.ts:329`), `closeAndFile`
      (`issues/lib/store.ts:414`) and `edit --status` (`issues/lib/issues.ts:228`) do not today, and the UI change
      signal fires only on events, so this is required, not a follow-up;
    - one job creator, `makeJob`, replaces the two run shapes of `dispatch` (`jobs/lib/transitions/transitions.ts:102`)
      and `openRun` (`jobs/lib/roles/agent-run.ts:72`);
    - one state writer, `setState`, replaces the 11 files that write `condition`; the column is `state`, the
      glossary word;
    - each word set is defined once in `lib/naming.ts`: `State` (`jobs/lib/records/ledger.ts:21`), `StageName`
      (`jobs/lib/records/stage.ts:19`), `Run.kind` and `Opening.role` (`jobs/lib/roles/agent-run.ts:33`) import it.
13. **"Kind" has one meaning per thing.** A job's `kind` is renamed `role` (build, review, land, …); `kind` stays for
    an issue (task, bug, …). Record-event and wait kinds go with the record (decision 11).
14. **Data loss allowed:** old `route` (256) and `routed` (268) events, fixture events and records (`tools-N`,
    `fac-N`, `oth-N`, `fac-dup`, `demo-N`), machine note lines and the `*.bak` files.
15. **Shown IDs are zero-padded, display only** (the user, 2026-11-14). One function in `lib/naming.ts`, used by the
    UI (`idLink`, `ui/views/lib/html.js`) and the terminal printers, shows a key with its number padded to 5 digits:
    `a-01234`, `b-00002`, `j-06802`. 5 is fixed, not taken from the counter, so widths never shift; jobs (6,826)
    reach it first, at 99,999. Stored keys stay unpadded (`issue.2`). The parser accepts leading zeros, so a copied
    `b-00002` resolves. The prefix letters of the shown form are decided in branch 2.

### What happens to the domain-model findings

`docs/findings/2026-11-13-domain-model-work-tracking.md` was input to this design. Each part's fate:

| Findings part | Fate |
|---|---|
| §1 model block for `docs/naming.md` | rewritten for the new model in step 2; the old block describes code that goes |
| §2 two-answer cases: job ID vs job, three job lookups, record key `issue`, state vs `condition` | gone: one job per execution, one key, column `state` |
| §2 event subject is any string; event owner derived from subject | gone: `object` is a key; owner comes from `event_rows.project` |
| §2 log events vs record events | merged (decision 11) |
| §2 "kind" four meanings | decision 13 |
| §2 two close writers, two run creators, drifted sets | decision 12 |
| §2 parse collisions, stale comments | gone with `parseId`, `subjectOf` and the routine list |
| §3 glossary conflicts | fixed by the `docs/naming.md` rewrite |
| §4 Q1–Q9 | answered by decisions 4, 9, 11 and 13; no question stays open |
| §4 follow-up bugs (close logging, sets, `plain` in `KINDS`, stale comments) | in this branch, so no issues are filed |
| §5 draft decision "A Job ID Numbers A Run" | taken, as decision 4 |
| §5 "Subjects And Event Subjects Share One Checked Grammar" | overturned: subjects are keys, not a grammar |
| §5 "An Event's Owner Is Derived From Its Subject" | overturned: from the job row's `project` |
| §5 "Job Records Are Keyed By Issue" | taken in part, as `issue_state` (decision 11) |
| §5 "Record History And The Event Log Stay Separate" | overturned (decision 11) |

The file stays as history, with a superseded line (step 2). No vault notes are written from its drafts; the vault gets
the decisions of this plan when it lands.

## Layout

```
~/.aleph/
  items/                      git: aleph-items restructured
    projects/3/project.md     frontmatter: name, code, path, main, env, setup, checks, sandbox, …; body: description
    issues/2072/issue.md      frontmatter: project, title, kind, priority, source, created, closed_as,
                              closed_at, closed_why, from, after; body: # Request, # Spec, # Notes
    issues/2072/<media>       screenshots, flat beside issue.md
    ideas/1/idea.md           frontmatter: title, project, status, built; body: write-up and log
    ideas/1/<lens>-<date>.md  lens results, flat
  jobs/6802/                  prompt.md, transcript.jsonl, result.md, log.txt (sections: command, setup,
                              stderr, dispatch, checks), pid, exit
  sessions/<session>/         images pasted into a UI chat
  aleph.db
  vault/                      unchanged
```

## `aleph.db` schema

```sql
CREATE TABLE counters (kind TEXT PRIMARY KEY, last INTEGER NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY, role TEXT NOT NULL, by TEXT NOT NULL, state TEXT NOT NULL, project TEXT,
  made INTEGER NOT NULL, started TEXT NOT NULL, ended TEXT, model TEXT, tier TEXT, cost REAL, commit_sha TEXT,
  pid INTEGER, exit_code INTEGER, target TEXT, prev TEXT REFERENCES jobs, retry_of TEXT REFERENCES jobs,
  was TEXT, extra TEXT);                      -- extra: JSON for the long tail of run fields
CREATE INDEX jobs_state ON jobs (state);
CREATE INDEX jobs_target ON jobs (target, started);
CREATE INDEX jobs_prev ON jobs (prev);
CREATE INDEX jobs_retry_of ON jobs (retry_of);
CREATE TABLE events (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL,
  object TEXT NOT NULL, detail TEXT);
CREATE INDEX events_time ON events (time);
CREATE INDEX events_object ON events (object, seq);
CREATE INDEX events_subject ON events (subject, seq);
CREATE VIEW event_rows AS SELECT e.*,
  s.role AS subject_role, o.role AS object_role, o.target AS object_target, coalesce(o.project, s.project) AS project,
  o.model, o.tier, o.cost, o.commit_sha, o.started, o.ended
  FROM events e LEFT JOIN jobs s ON s.id = e.subject LEFT JOIN jobs o ON o.id = e.object;
CREATE TABLE issue_state (issue TEXT PRIMARY KEY, ask TEXT, ask_job TEXT REFERENCES jobs, wait_kind TEXT,
  wait_reason TEXT, wait_since TEXT, ci TEXT);  -- ask and ci: JSON; a row exists only while something is live
CREATE TABLE tick (step TEXT PRIMARY KEY, last TEXT, result TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- one table each for usage, openrouter spend, jev cost, suite history, flaky checks: (seq, time, …)
```

Rules: WAL, `busy_timeout`, `synchronous=NORMAL`; no read transaction outlives one request;
`wal_checkpoint(TRUNCATE)` after any long read; links as indexed key columns, never JSON arrays; a transaction never
spans a git call or a process start; the file stays on ext4. An event and its change are one transaction only when
the change is all in `aleph.db`; a change with a git half commits git first, then logs. Event order is `seq`.
- Every counter bump and read-modify-write runs in `BEGIN IMMEDIATE`.
- An issue takes its number from the counter before the git write and push; a failed push leaves a gap, and gaps are
  allowed.
- `pid` and `exit` stay files in `jobs/<n>/` (`aleph job`, liveness in `jobs/lib/infra/process.ts` and Sidetone's
  `src/working.ts` read them); the row gets a copy when the job ends.
- `PRAGMA user_version` from the first schema. The tick takes a daily `VACUUM INTO` backup; never `cp` the live file.
- A test holds a reader open and checks that the WAL stays bounded.

## Branch 1: `feature/storage-ids`

0. **Pause:** `aleph pause`; `aleph jobs` until nothing is live. It stays paused until the migration has run. During
   the real run, also stop `aleph-tick.timer`, `aleph-suite.timer`, `aleph-ui.service` and Sidetone's timers, and file
   no issues by hand.
1. **Fixture leak:** find the test that writes `tools-N` events to the live log (bursts of 4, 2026-11-13 17:00–17:07
   UTC) and isolate it. Lands first, alone.
2. **Keys and words:** `lib/naming.ts`: the `<kind>.<n>` parser and builder, the new trailer forms, the event shape
   and words (subjects `gate`, `rule`, `human`, `claude`; actions without `refused`; `stalled` in the action set),
   the sentence renderer on `action` plus `detail`. Remove `setCodes`, `FULL`/`SHORT`, `subjectOf`, `jobId`,
   `parseJob` and the `OLD` word map once the migration rewrites old words. Each word set is defined here once
   (decision 12). Rewrite `docs/naming.md` with the findings' model block redone for the new model (Issue, Job,
   Event, issue state), and reconcile `docs/data-model.md`, which the findings did not read. Add one line at the
   top of `docs/findings/2026-11-13-domain-model-work-tracking.md`: superseded by `docs/naming.md` and this plan,
   with its draft decisions 1 and 4 taken, 2, 3 and 5 overturned (see the plan's findings table).
3. **`aleph.db`:** a new module (`lib/db.ts`) with the schema, open options and counters. Replace the internals of
   `jobs/lib/records/record.ts` and `ledger.ts` (`makeRun`, `allRuns`, `keyOfId`, `archiveOld`) behind their current
   API where it holds, and the path layer in `lib/layout.ts` with its env overrides; `logEvent` writes the 6-field
   event. `makeJob` and `setState` are the one creator and the one state writer; `issue_state` holds the Ask, wait
   and `ci`; record events go to `events`; every issue close logs (decisions 11 and 12). `landTurn` orders by the
   numeric job number; stall detection reads the mtime of `log.txt`. Move `tick.json`
   (`editTick`), `factory/*.json` state and the usage logs to tables. Settings commands write `settings` and log an
   event. Check that no reader needs `cost` or `commit` from events rather than the job row.
4. **Jobs as executions:** each run becomes a job with `target`, `prev` and `retry_of`; the reviewer becomes its own
   job; routine and plain runs become jobs. `jobs/<n>/` with its files; `runFile` owns every name, and the about 20
   hand-written names move to it. Retention deletes job folders after 90 days and keeps rows.
5. **Chat as a session:** `ui/api/chat.ts` keeps one stream-json process per open conversation, with an idle timeout
   and `--resume` after it; images to `~/.aleph/sessions/<session>/`; remove the `chat` kind, chat `openRun` and
   `chatLock`. First test more than 2 turns, an image turn, and Langfuse tracing of the server's process.
6. **Items:** `issues/lib/todo.ts` (headings format, one date set, `from` only), `issues/lib/store.ts` (paths,
   `writeList` on `items/`, the number taken from the counter before the push), `ideas/ideas.ts`, and the registry
   read from `items/projects/`. Drop Backlog.md `config.yml`, `floor.json` and the `issues-media/` copy. Change every
   other reader of the old layout: the about 15 tests that write `repos.json` with `ALEPH_REPOS`,
   `hooks/git-guard.ts` (`storeDir`), Sidetone's `src/project.ts`, and the docs that state the old layout
   (`docs/observability.md`, `docs/factory.md`, `docs/issues.md`, `docs/data-model.md`, `README.md`,
   `identity/CLAUDE.md`, `identity/AGENT.md`).
7. **UI:** the UI server polls `PRAGMA data_version` every 100 ms on an idle connection; when it moves, it reads
   `events WHERE seq > last` and pushes `change` for the objects those events name. After its own writes it pushes
   directly. Writes without an event (usage, tick) stay on the quiet refresh timer. Job routes `#/jobs/job.6802`.
   Every event reader (`ui/state.ts`, `ui/api/gates.ts`, `ui/api/events.ts`, `jobs/lib/gates/factory-status.ts`)
   reads `event_rows`, so `ui/views/now.js` and `ui/views/gates.js` get the issue, model, cost and commit with each
   event; `say()` in `lib/naming.ts` uses `subject_role` and links keys in `detail`. The issue page reads jobs by
   `target`.
8. **Migration:** `aleph migrate storage` (`jobs/lib/migrate.ts`).
   - Back up: one tar, `~/.aleph/backups/storage-<date>.tgz`, of all of `~/.aleph` except `vault/`, `prior-art/`
     and `backups/` (3.8 GB; 443 GB free). Then convert in place. Keep the tar until the user deletes it.
   - Undo: stop the services of step 0, delete `items/`, `aleph.db*` and the converted paths, untar, revert the code
     on main.
   - Restructure `aleph-items` into `items/`, subtree-merge `aleph-ideas`, write `projects/` from `repos.json`.
     Archive `aleph-ideas` on GitHub only after the first verified push of `items/`.
   - Number projects (order of `repos.json`), issues (aleph keeps its numbers), ideas and jobs (start order, ties by
     folder name).
   - Convert records and run folders to job rows and `jobs/<n>/`; scan old trailers for missing `commit_sha`; fold
     record-local `events` into `events`; import the JSONL log into the 6-field shape (`by` to `subject`, the old
     subject or job to `object`, `sub`/`file`/`count`/`note` to `detail`), dropping what decision 14 lists. `seq` is
     assigned in file order; no event has a `seq` today.
   - `--dry-run` prints counts per kind and every unmapped key; the real run refuses while any is unmapped.
   - Check: export the database back to JSON and compare counts and fields with the backup, with the drops of
     decision 14 as the allow-list.
9. **Cleanup:** delete `factory/*.bak`, `repos.json.bak-*`, `tick.converted`, `words-migrated`, old logs.
10. **Rehearse:** migrate a copy of `~/.aleph`, point a session at it through the `lib/layout.ts` overrides, and run
    one live job from start to land on the copy. First check that the overrides cover every path the job touches.
11. **Run it:** dry run, show the user the counts, real run, `aleph resume`.

Not read yet, placed during step 3: `factory/episodes/`, `episodes-seen`, `seen`, `monitor/`, and the subjects
`came-due`, `detached`, `factory`, `jobdiff`. Sidetone's `/tell` parse of job IDs is read before landing.

Follow-ups, not in this branch: directory locks for land, rescue and dispatch as database leases; documents
(handoffs, plans, reports, sketches) as an `items/` kind.

## Branch 2: `feature/herald-b2`

As in the vault note: one-line rows (time, action chip, object, title, `+N`); folds on a 2px `--rule` guide line;
one row per attempt (a build and its `prev` chain); routine runs say `N changes`; status rows only on a change; the
Running line; stalls fold into their issue; chat rows are one conversation, read from its session; filter toggles
Work and Factory, matched on `target`, kept through `keep()`. Shown forms are decided here (for example `2072` or
`issue.2072`). Files: `ui/views/now.js`, `ui/app.css`, `docs/design.md` (closes aleph-2142, aleph-2143), the render
tests. The mocks on `docs/herald-mock` land with it after an update to the new keys.

## Verification

- **Branch 1:** `bun test` in the worktree, counts reported. The writer benchmark rerun against `lib/db.ts` with 20
  processes, and the WAL-bound test. The migration on a copy of the live store: dry-run counts equal the real run;
  the export round trip shows only the allowed drops. The rehearsal job lands on the copy. After the real run:
  `aleph status`, `aleph jobs`, `aleph report`, one record of each kind read back, the `commit_sha` of migrated job
  `a2025#2` equal to the commit its old trailer names, a chat conversation of 3 turns with an image, the UI opened on
  a one-off port of 3002 or above. Then `aleph resume` and one live job watched from start to land.
- **Branch 2:** `bun test`, then `aleph:verify-ui` in light, dark and 480 px: collapsed, an issue fold, a housekeeper
  fold, a chat fold, a status change, each filter, the Running line; console clean.

## Git

Solo mode: pieces that touch different files run as worktree agents in parallel (step 1 alone; then 2; then 3, 5 and
6 in parallel; then 4 and 7; then 8 and 9; then 10). Each commits on its branch and does not land; Claude reads each
diff, runs its check and lands one at a time on `feature/storage-ids`, which squashes to main once the migration has
run.

## Open

- The job row's `by` column (who started the job) keeps its name for now; rename with the event words if wanted.
- `settings` as the object of settings events is tentative.
- Claude's calls, not yet seen by the user: `kind` to `role` on jobs (decision 13), `issue_state` and the merge of
  record events (decision 11), `makeJob` and `setState` (decision 12), the `event_rows` view and `jobs.project`.
