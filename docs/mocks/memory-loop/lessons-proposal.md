# Lessons UI: proposal

## Decisions

1. Build option 1: one new page, `#/lessons`. It holds a ledger of decided lessons and an Always rules section.
2. Link to it from the Lessons card (Automation, `ui/views/lib/processes.js:41`) and from the Ask card's "Technical details" (`ui/views/lib/ask-cards.js:72`).
3. Keep the Automation Rules table as it is. It stays the place to grant and revoke.
4. Show four numbers only (see Numbers).
5. Make the data changes in "Data changes" first. The page cannot show who decided or what landed without them.
6. Assumption: a new route `GET /api/lessons` reads `readStore()` (`jobs/lib/learning/corrections.ts`) and the events table. No new store.

## Options (mocks in this folder)

| Option | Surfaces | Agent minutes | Cost of the gap |
|---|---|---|---|
| `lessons-1.html` ledger page, records open in place, Always section | 1 new page | 150 | none |
| `lessons-2.html` record page per lesson with a timeline, Always columns in the Rules table | 1 new route, 1 edited table | 210 | needs lesson events (below) |
| `lessons-3.html` fold on the Lessons card, table on Automation | 0 new pages | 70 | no signals list, no record per lesson |

Recommendation: option 1. It meets all six asks with the fewest surfaces. Option 2 adds a timeline that needs one event per step (proposed, decided, landed). Build that on option 1 later. Option 3 hides the Always effect on a busy page.

## Lesson record (option 1)

Four steps, left to right: Signals, Decision, Change, After.

- Signals: deduped count, count by source, first and last date, 3 newest quotes with their trace or job link.
- Decision: director advice, the decision, who decided (Chris click, Always rule, unknown).
- Change: issue, landing commit, where the rule lives now (`identity/CLAUDE.md:67`).
- After: signals before and after the land, days since the land.

## Always rules

One row per rule: when set, when off, count of acts, what it did. A lands row carries a red badge when the land touched a security path. Today `held-path:aleph` shows 25 lands, 18 issues, and 17 security-path commits (the 17 is from aleph-3313; I did not recount it). `review-held:aleph` shows 2 lands over a hold.

## Numbers

| Number | Definition | Action |
|---|---|---|
| Decided 22, 7 approved | lessons decided; approved / decided | None alone. It is the denominator for the next one. |
| Against advice 4 of 4 | approved lessons with director advice "decline" / lessons with advice | If it stays high, change the director prompt or stop its advice on lessons. n is 4, so show counts, not a rate. |
| Lines still missed 3 of 3 | CLAUDE.md lessons with signals after the land (aleph-942 excluded: line removed in 31bbcd8e) | Promote a missed line to a check. 1203 has 8 before and 59 after in 14 days. |
| Landed unasked 25 | Always lands with no hold, 17 on security paths | Revoke any rule that lands a security path. |

The After column means different things by kind. For a `claude-md` lesson it counts misses. For a `check` lesson the verify gate is both the fix and the signal source, so the count is probably the check firing (a catch, PRINCIPLES.md rule 4). I did not verify this split. The page labels it by kind.

## Data changes

| Change | One writer | Files | Today |
|---|---|---|---|
| `decidedBy` (`chris` or the rule key) and `decidedAt` on the lesson | `approve`, `decline` in `jobs/lib/learning/corrections.ts:316,362`, called with a `by` argument from the route (`ui/api/proposals.ts:12,20`) and from `standingProposals` (`corrections.ts:270`) | corrections.ts, proposals.ts, `ask.ts` (the Always grant click that approves open proposals) | New field. Only `declinedAt` exists (`corrections.ts:38`). 1203 and 2956 show Always by the 1 s grant match, not by a record. |
| `landed: {commit, at}` on the lesson | the land path, `jobs/lib/land/landing.ts` (`settleOnMain`, line 105; I did not read its body) | landing.ts, corrections.ts | Derived today by `git log --grep '<issue>'`. This works for 7 of 7, but it depends on subjects that name the issue. |
| Dedupe signals | `group` in `corrections.ts:191-196`, key `source+at+quote` | corrections.ts | 1123 has 6 duplicates and 2956 has 2. Display can dedupe now. |
| Bound decided signals (PRINCIPLES.md rule 8) | `mine` in `corrections.ts:201` | corrections.ts | After a decision keep `{at, source}` for all and quotes for the newest 20. A quote is up to 300 chars, 790 signals now. |
| `rule` on rule events | `logAlways`, `jobs/lib/asks/ask.ts:247` | ask.ts, `lib/naming.ts:138` (Event), `lib/db.ts:26` | Rule events carry only a text `detail` ("a protected file"). Mapping to a rule by that text breaks PRINCIPLES.md rule 9. |
| `path` on a held-path land event | `director.ts:680` calling `logAlways` | director.ts | New field. Without it the security-path badge shows on the rule, not on each land. |

Derivable now: signals, advice, decision state, issue, commits (by grep), before/after, rule set and off times (settings events `Always: <reason> is <action>`), lands by rule (events). Needs a new field: who decided, a trusted land commit, a per-land path, and the rule key on events.

## Not verified

- The grant time for `proposal-claude-md:global` (1203): no `Always` event for it is in the log, so I cannot date it.
- Who approved 616, 942, 1008, 1040, 1123. The page shows "Unknown" for them.
- Commit for 2956 (`6a231955`) found by text search of the change, not by its subject.
- The 25 events versus 18 issues versus 17 commits: three counts I did not reconcile.
- Cost minutes are my estimates from the file count, not a run.
- I did not edit the repo. The mocks are static: `build.ts` generates them with the real `ui/views/lib/html.js` helpers and `ui/app.css`.
