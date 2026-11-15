# 1. Holds are events

- Status: accepted
- Date: 2026-11-15

## Context

An issue that does not start has a reason: it waits on another issue, its job is open, it shares a busy file, main is red, a backend is out of credit, the factory is paused, or the live cap is full. That reason was stored twice: `issue_state` carried `wait_kind`, `wait_reason` and `wait_since`, written by the dispatch, and the same fact was a hold event in the log. The two could disagree, because a dispatch that died between the two writes left an issue held with no column, and a column could outlive the hold that wrote it. The columns also held one word each, so a hold's facts (which issues, which job, which file, how many runs with no commit) were dropped.

## Decision

A hold is an event, not stored state.

- An issue hold is one `held` event: subject `gate`, object the issue key, detail the hold word and then its facts (`after: issue.2985 issue.2993`). The dispatch writes it only when its detail changes, and a start ends the hold. `issue_state` keeps no wait: `wait_kind`, `wait_reason` and `wait_since` go in schema version 7.
- The factory gates — the pause, the backend the factory holds after a call ended with the API credit error, and the live cap — are settings changes, not issue holds. Each logs one `changed` event on `settings` when it starts and one when it ends (`pause: on`, `credit: on: claude: API credit error`, `cap: on: 5 / 5 jobs`), and a dispatch that skips an issue for one writes no hold on it.

## Consequences

- A reader takes the issue's hold from its latest `held` event, and the hold word from the detail before the first colon, in place of reading a column. It has to check that no later `started` event ended the hold: `subjectOf` in `jobs/lib/records/stage.ts` reads the latest of the two, indexed by object. A column would have answered both with one read.
- One record of a hold, so no writer can leave the row and the event disagreeing, and a hold carries its facts.
- The factory gates are not visible on an issue. A reader who wants to know why nothing started reads the `settings` events, not the issue.
- Old hold events keep their own actions (`paused`, `red`, `after`, `full`, `busy`, `looping`, `credit`) and are still read: `OLD_HOLDS` in `lib/naming.ts` lists them, and no code writes them.
