# Domain model: aleph's work-tracking cluster

The cluster has one central two-answer case. The code's **Job** is a group of runs that share `run.job`, the folder name of the group's first run. But a "job ID" (`a1430#2`) belongs to each run. So one job with a build, a fix round and a land has three job IDs. Most of the other conflicts follow from this one.

The result of one `aleph:domain-modeling` run on 2026-11-13, made before the jobs refactor as input to its design. Nothing in it is applied yet.

## 1. Model block

This block goes after the Terms table in `docs/naming.md`.

```md
**Model: Work tracking**
- **Issue**
  - Identity: `<repo>-<n>` (full) or `<code><n>` (short), parsed by `parseId` at `lib/naming.ts:68`. An old part is `<repo>-<n>.<k>` (`lib/naming.ts:62`). The repo counter that gives `<n>` is not read here (intended).
  - Lifecycle: open, parked, done, dropped (`lib/naming.ts:7`). The status is not a stored field. It is derived: `closed_as`, else `parked`, else open (`issues/lib/todo.ts:75`). `setStatus` allows any move (`issues/lib/todo.ts:244`). A close clears `parked` (`issues/lib/todo.ts:253`). A reopen to open sets `since` and reopens a closed parent (`issues/lib/store.ts:350`).
  - Owner: the work store under `issues/lib`. Creation has one door, `writeFiling` (`issues/lib/store.ts:374`). Closes have three writers (conflict: `issues/lib/issues.ts:245` vs `issues/lib/store.ts:329` vs `issues/lib/store.ts:404`), and `edit --status` is a fourth (`issues/lib/issues.ts:228`). Readers: the factory, `stage()` (`jobs/lib/records/stage.ts:96`), the UI.
  - Invariants: each new issue logs one `filed` event (`issues/lib/store.ts:388`). A part of a parked parent is not buildable (`issues/lib/store.ts:234`). Each close logs `done` or `dropped` (conflict: `issues/lib/issues.ts:256` logs, but `issues/lib/store.ts:319` and `issues/lib/store.ts:414` do not).
  - Relations: many Links (`from`, `after`, `related`). Parts via `partsOf` and `parentOf` (`issues/lib/store.ts:218`, `issues/lib/store.ts:220`). Many Jobs. One Job record.
- **Job**
  - Identity: (conflict: `jobs/lib/records/ledger.ts:178` vs `jobs/lib/records/record.ts:330`). The group key is `run.job`, the folder name of the first run (`jobs/lib/records/job.ts:36`, `jobs/lib/transitions/transitions.ts:102`, `jobs/lib/roles/agent-run.ts:69`). The job ID `<subject>#<n>` takes the `n` of each run, so each run of one job has its own job ID (`jobs/lib/records/ledger.ts:211`). The `Job:` trailer uses the first run's ID (`jobs/lib/records/ledger.ts:192`). A third key is `name`, which lookups use (`jobs/lib/records/job.ts:24`).
  - Lifecycle: the state of the run that counts (`jobs/lib/records/job.ts:45`, `jobs/lib/records/record.ts:341`). A job is open in running, passed, waiting, returned or failed (`jobs/lib/records/ledger.ts:129`). A plain job is open only while its process lives (`jobs/lib/records/ledger.ts:230`). The next step comes from `next()` (`jobs/lib/records/record.ts:351`). No table of legal moves exists: 11 files write `condition`.
  - Owner: starts through `dispatch` (`jobs/lib/transitions/transitions.ts:80`) and `openRun` (`jobs/lib/roles/agent-run.ts:66`), both through `makeRun` (`jobs/lib/records/ledger.ts:205`). Readers: `view` for `/api/jobs` and `aleph jobs` (`jobs/lib/records/job.ts:114`).
  - Invariants: a name has at most one open job (`jobs/lib/records/job.ts:23`), held by the lock `job-<repo>-<name>` (`jobs/lib/transitions/transitions.ts:169`). A director run never counts (`jobs/lib/records/record.ts:335`). All runs of a job share its branch and worktree (`jobs/lib/transitions/transitions.ts:180`).
  - Relations: one Subject. Many Runs. It is in one Job record, which can hold many jobs (`jobs/lib/records/record.ts:139`).
- **Run**
  - Identity: the run folder `<stamp>-<subject file-safe>-<n>` (`jobs/lib/records/ledger.ts:214`). The stamp is local time (`jobs/lib/records/ledger.ts:270`). `n` counts per subject from 1 (`jobs/lib/records/ledger.ts:107`).
  - Lifecycle: `condition` takes a word from running, waiting, passed, returned, failed, landed, dropped, done (`jobs/lib/records/ledger.ts:21`). Kinds include `plain` (`jobs/lib/records/ledger.ts:42`).
  - Owner: `makeRun` alone makes folders (`jobs/lib/records/ledger.ts:205`). The state lives in the Job record through `putRun`, `patchRun` and `endRun` (`jobs/lib/records/record.ts:231`, `jobs/lib/records/record.ts:252`, `jobs/lib/records/record.ts:272`). The folder keeps logs, `pid` and `exit` (`jobs/lib/records/record.ts:7`).
  - Invariants: `n` is unique per subject, under the lock `start-<subject>` (`jobs/lib/records/ledger.ts:208`). On one subject, folder names sort in start order (`jobs/lib/records/ledger.ts:213`). A run is in exactly one record and moves when its `on` changes (`jobs/lib/records/record.ts:233`).
  - Relations: one Job (`run.job`). One Subject. One Job record.
- **Job record**
  - Identity: the key is `run.on`, else `run.job` (`jobs/lib/records/record.ts:61`). It is stored in a field named `issue` (`jobs/lib/records/record.ts:32`), at `~/.aleph/jobs/<key>.json` (`lib/layout.ts:30`, `jobs/lib/records/record.ts:85`).
  - Lifecycle: live, then archived 7 days after its newest run when finished with no Ask and no wait (`jobs/lib/records/record.ts:116`). Any write takes it out of the archive (`jobs/lib/records/record.ts:195`).
  - Owner: `jobs/lib/records/record.ts` alone opens it (`jobs/lib/records/record.ts:3`). Readers: `allRuns`, `stepOf`, the UI.
  - Invariants: each write is whole, under the record's lock, through a temp file and a rename (`jobs/lib/records/record.ts:151`, `jobs/lib/records/record.ts:188`). `cost` and `rounds` are derived (`jobs/lib/records/record.ts:134`). There is at most one Ask, owned by `askRun` or by the issue (`jobs/lib/records/record.ts:33`).
  - Relations: one Issue, or one job with no issue. Many Runs. Many record events (`jobs/lib/records/record.ts:28`).
- **Subject**
  - Identity: `run.on`, else the routine (the run's kind), else the run's `name` (`lib/naming.ts:90`). There are three forms.
  - Lifecycle: none. It is derived.
  - Owner: `subjectOf` (`lib/naming.ts:90`). (conflict: `lib/naming.ts:90` vs `jobs/lib/records/stage.ts:67`, a second `subjectOf` that returns an issue view.)
  - Invariants: a plain run's name can read as an issue ID. `parseId("fix-2")` gives `{repo: "fix", n: 2}` (`lib/naming.ts:62`).
  - Relations: many Runs, numbered by `n`.
- **Routine**
  - Identity: one name from monitor, chat, lens, housekeeper, maintainer (`lib/naming.ts:32`). Job ID `<routine>#<n>` (`lib/naming.ts:93`).
  - Lifecycle: a routine run ends `done` and never lands (`jobs/lib/roles/agent-run.ts:61`).
  - Owner: the list at `lib/naming.ts:32`. Runs start through `openRun` (`jobs/lib/roles/agent-run.ts:66`).
  - Invariants: a routine run with an `on` takes the issue as its subject (`lib/naming.ts:90`). Director is a run kind, not a routine (`lib/naming.ts:22`).
  - Relations: the Subject of many Runs.
- **Event**
  - Identity: none. It is one line in `factory/events/<UTC day>.jsonl` (`lib/layout.ts:40`).
  - Lifecycle: append only. A past day never changes (`lib/layout.ts:33`).
  - Owner: one door, `logEvent` (`lib/layout.ts:37`), which checks words through `event()` (`lib/naming.ts:115`). There are many callers. Readers: `readEvents` (`lib/layout.ts:51`).
  - Invariants: `by`, `action`, `sub`, `result` and `to` are in their sets (`lib/naming.ts:116`). `subject` is not checked (`lib/naming.ts:115`).
  - Relations: one subject, many `on` IDs. A second store, record events (`jobs/lib/records/record.ts:28`), is also called "events".
- **Event owner**
  - Identity: no field. It is derived by `eventIn` (`ui/api/scope.ts:35`).
  - Lifecycle: none.
  - Owner: `ui/api/scope.ts:35` alone.
  - Invariants: a subject that parses as an issue belongs to that issue's project. Every other subject belongs to every project (`ui/api/scope.ts:36`). The issue, project and factory owners exist only as intent (intended).
  - Relations: one per Event.
```

## 2. Two-answer cases

**Two names for one thing**
- **Job ID vs job.** `jobIdOf` numbers each run (`jobs/lib/records/record.ts:330`). `allJobs` groups runs by `run.job` (`jobs/lib/records/ledger.ts:178`).
- **"Job id" means two things.** In record.ts it is `run.job`, a folder name (`jobs/lib/records/record.ts:6`, `jobs/lib/records/record.ts:32`). In naming.ts it is `<subject>#<n>` (`lib/naming.ts:93`).
- **Three job lookups.** By `name` (`jobs/lib/records/job.ts:24`), by first folder (`jobs/lib/records/job.ts:36`) and by job ID (`jobs/lib/records/ledger.ts:186`).
- **"Work state" vs `JobRecord`.** The glossary says Work state (`docs/naming.md:15`). The code says JobRecord (`jobs/lib/records/record.ts:30`).
- **The record key field is named `issue`.** It holds a job's folder name when the job has no issue (`jobs/lib/records/record.ts:32` vs `jobs/lib/records/record.ts:61`).
- **State vs condition.** The term and set are "state" (`lib/naming.ts:8`). The field is `condition` (`jobs/lib/records/ledger.ts:44`).

**One word with two meanings**
- **Subject.** A job's subject (`lib/naming.ts:90`) vs an issue view in stage (`jobs/lib/records/stage.ts:40`, `jobs/lib/records/stage.ts:67`).
- **Event subject.** It is any string. Examples: an Ask reason (`jobs/lib/asks/ask.ts:237`), a repo key (`jobs/lib/gates/firefighter.ts:217`), a step name (`jobs/lib/transitions/factory.ts:70`), a note title (`vault/lib/ops.ts:234`) and a record key (`jobs/lib/records/record.ts:163`).
- **Event.** Log events (`lib/naming.ts:111`) vs record events (`jobs/lib/records/record.ts:28`). The director writes the same decision to both (`jobs/lib/roles/director.ts:139`, `jobs/lib/roles/director.ts:144`).
- **"Jobs" in stage.** `stage.ts` calls runs "jobs" (`jobs/lib/records/stage.ts:51`, `jobs/lib/records/stage.ts:64`).
- **Kind.** Run kind (`jobs/lib/records/ledger.ts:42`), issue kind (`lib/naming.ts:21`), record event kind (`jobs/lib/records/record.ts:27`) and wait kind (`jobs/lib/records/record.ts:40`).

**Two writers for one entity**
- **Issue close.** `issues.ts close` logs an event (`issues/lib/issues.ts:256`). `store.close` does not (`issues/lib/store.ts:329`), and firefighter and checked use it (`jobs/lib/gates/firefighter.ts:179`, `jobs/lib/transitions/transitions.ts:272`). `closeAndFile` does not (`issues/lib/store.ts:414`), and landing uses it (`jobs/lib/land/landing.ts:89`). `edit --status` does not (`issues/lib/issues.ts:228`).
- **Run creation.** `dispatch` (`jobs/lib/transitions/transitions.ts:102`) and `openRun` (`jobs/lib/roles/agent-run.ts:72`) each build their own run shape.

**Drifted sets**

`docs/naming.md:3` says no other file defines a set. These files do:
- `State` (`jobs/lib/records/ledger.ts:21`) vs `STATES` (`lib/naming.ts:8`).
- `StageName` (`jobs/lib/records/stage.ts:19`) vs `STAGES` (`lib/naming.ts:29`).
- `Run.kind` (`jobs/lib/records/ledger.ts:42`) vs `KINDS` (`lib/naming.ts:22`). `KINDS` has no `plain`.
- `Opening.role` (`jobs/lib/roles/agent-run.ts:33`).

**Parse collisions**

A scratch `bun -e` run confirmed both:
- `parseId("20261105-080726-fix-1")` gives `{repo: "20261105-080726-fix", n: 1}`. A plain job's Ask events use a record key of this form (`jobs/lib/records/record.ts:163`). They then belong to no project under a filter (`ui/api/scope.ts:32`).
- `parseId("fix-2")` gives `{repo: "fix", n: 2}`, so a plain run name reads as an issue.

**Stale comments**
- `jobs/lib/roles/agent-run.ts:31` says the subject is "`monitor` for the monitor". There are five routines (`lib/naming.ts:32`).
- `ui/api/scope.ts:34` says "issue or job". `parseId("a1430#2")` returns null.

## 3. Glossary conflicts

**`docs/naming.md` vs the code**
- **Routine** (`docs/naming.md:12`): the glossary lists monitor and chat. The code lists five (`lib/naming.ts:32`).
- **Subject** (`docs/naming.md:13`): "an issue or a routine". The code adds a plain run's name (`lib/naming.ts:90`).
- **Job** (`docs/naming.md:14`): "has a folder, a log, a cost and a state". Those belong to a run. The code's job is a group of runs (`jobs/lib/records/ledger.ts:175`).
- **Run** (`docs/naming.md:17`): it is listed as an old word for job. The same page uses "run" as its own thing (`docs/naming.md:34`, `docs/naming.md:39`).
- **Job ID** (`docs/naming.md:26`): "numbered from 1 in start order" on the subject. That counts runs, not jobs (`jobs/lib/records/ledger.ts:211`).
- **Work state** (`docs/naming.md:15`): "stored in `~/.aleph/jobs/<issue>.json`". A job with no issue keys by folder name (`jobs/lib/records/record.ts:61`).
- **Close events** (`docs/naming.md:39`): "`close` logs `done` or `dropped`". Two of three close paths log nothing (`issues/lib/store.ts:319`, `issues/lib/store.ts:414`).
- **Kind set** (`docs/naming.md:86`): it has no `plain` (`jobs/lib/records/ledger.ts:42`).
- **Owner** (`docs/naming.md:3`): "no other file defines … a state list". It is broken at `jobs/lib/records/ledger.ts:21` and `jobs/lib/records/stage.ts:19`.

**The proposal vs the code**
- **Plain-run ID.** The proposal's "Today" column gives `<folder>#1` (plan:33). The code gives `<name>#<n>` (`lib/naming.ts:90`, `jobs/lib/records/ledger.ts:187`).
- **Folder names.** The proposal says folder names "stay fixed" (plan:17). New folder names embed the subject (`jobs/lib/records/ledger.ts:214`). Unit names embed the folder (`jobs/lib/transitions/transitions.ts:112`). From memory of systemd, not checked here: `@` marks a template unit and `!` is not a legal unit-name character.
- **Firefighter and director.** The proposal makes them routines `!ff` and `!dr` (plan:34). Firefighter is an actor with no run kind (`lib/naming.ts:19`, `lib/naming.ts:22`). Director runs have their own subject (`jobs/lib/roles/director.ts:139`).
- **Two job ID grammars.** `!hk57` has no `#`, but `a2138#3` does (plan:31, plan:34).
- **`@<repo>` for a plain run.** `startPlain` sets no `repo` (`jobs/lib/transitions/transitions.ts:208`).
- **Missing subjects.** The grammar does not cover note titles (`vault/lib/ops.ts:234`) or Ask reasons (`jobs/lib/asks/ask.ts:237`). The proposal says `event()` will throw on them (plan:21).
- **Record keys.** The proposal changes `keyOf` (plan:64). Only plain jobs key by `run.job`, and that is a folder name, not a subject.

## 4. Questions for Chris

1. **What is a Job's identity?**
   - (a) A job is the group of runs (`run.job`), and `#n` numbers jobs, so a fix round keeps `a1430#2`.
   - (b) A job is one run, as `docs/naming.md:14` reads, and `#n` stays per run. The group gets its own name.

   The code does (b)'s numbering with (a)'s grouping (`jobs/lib/records/record.ts:330`, `jobs/lib/records/ledger.ts:178`). **Recommend (b).** The trailers in git history already carry per-run IDs (`jobs/lib/records/ledger.ts:192`), so (a) rewrites history's meaning.
2. **What word names the run group?** This applies if Q1 is (b).
   - (a) Track.
   - (b) Line.
   - (c) Keep it internal, with no glossary term.

   **Recommend (c).** Only `allJobs` and the record's `rounds` use the group (`jobs/lib/records/record.ts:139`).
3. **What is the record called?**
   - (a) "Job record", the code's name.
   - (b) "Work state", the glossary's name.

   **Recommend (a).** Also rename the `issue` field to `key` (`jobs/lib/records/record.ts:32`).
4. **Does Subject have a third form, a plain run's name?**
   - (a) Yes, in a grammar that cannot parse as an issue ID.
   - (b) No. Plain runs take a repo or factory subject.

   **Recommend (a).** `parseId("fix-2")` gives an issue today (`lib/naming.ts:62`).
5. **Do job subjects and event subjects share one grammar?**
   - (a) One grammar, checked in `event()`. It must also cover note titles and Ask reasons.
   - (b) Two terms: `subject` for jobs, a different word for an event's topic.

   **Recommend (a).** Add forms for `vault/lib/ops.ts:234` and `jobs/lib/asks/ask.ts:237` before `event()` starts to throw.
6. **Where does an event's owner (issue, project or factory) come from?**
   - (a) Derive it from the subject grammar.
   - (b) Store an `owner` field on each event.

   **Recommend (a).** Today repo-key subjects belong to every project (`ui/api/scope.ts:36`).
7. **Should record events keep the word "event"?**
   - (a) Rename them to `history`.
   - (b) Merge them into the log.

   **Recommend (a).** `next()` reads them per record (`jobs/lib/records/record.ts:362`), and the log is split by day.
8. **Which names are routines?**
   - (a) The five at `lib/naming.ts:32`.
   - (b) Those five plus director and firefighter, as the proposal says.

   **Recommend (a).** Firefighter has no runs, and director runs have their own subject.
9. **Do routine job IDs keep `#`, as `!hk#57` does?**
   - (a) Yes.
   - (b) No: `!hk57`, as the proposal has it.

   **Recommend (a).** Then `parseJob` keeps one rule (`lib/naming.ts:96`).

These are bugs, not decisions, so they are follow-ups to file:
- Every issue close should log `done` or `dropped` (`issues/lib/store.ts:329`, `issues/lib/store.ts:414`, `issues/lib/issues.ts:228`).
- The duplicate sets should import from `lib/naming.ts`.
- Add `plain` to `KINDS`.
- Fix the two stale comments.

I did not file them because this run's brief allows no writes.

## 5. Draft decisions that pass all three tests

Each of these is hard to reverse, would surprise a later reader, and had real alternatives.

- **A Job ID Numbers A Run, Not A Job.** A `<subject>#<n>` ID names one run, so a job's fix round and land get new numbers, because commit trailers already carry per-run IDs. (Depends on Q1.)
- **Subjects And Event Subjects Share One Checked Grammar.** Every subject is an issue ID, a repo form or a system form, and `event()` refuses any other, so the owner and links derive from the subject. (Q4, Q5, and the proposal's rename.)
- **An Event's Owner Is Derived From Its Subject.** Events store no owner field. The issue, project or factory owner comes from the subject grammar, so the log schema does not change. (Q6.)
- **Job Records Are Keyed By Issue, Not By Job.** One record file holds every job on an issue, so the Ask and wait state outlive each job. (Q3.)
- **Record History And The Event Log Stay Separate.** The per-record history drives the next step, and the daily log is for display and reports, so neither depends on the other's lifetime. (Q7.)

The routine list (Q8) and the `#` in routine IDs (Q9) fail "hard to reverse", so they get no note.

**Not verified:**
- I did not read `docs/data-model.md`, which `record.ts` and `layout.ts` cite. It may be a third glossary.
- I did not read how `issues.add` assigns numbers.
- I did not read whether Sidetone parses job IDs.
- I did not check the systemd unit-name rules here.

A hook rewrites some shell commands, so auto mode would not run them. I read those files with the file reader instead, and nothing was missed.
