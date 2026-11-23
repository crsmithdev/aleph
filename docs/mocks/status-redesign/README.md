# Status redesign mocks

Chris asked on 2026-11-21 for a clean re-think of the Status page (`ui/views/now.js`): keep cards like the scorecard,
add an event viewer, and show at a glance memory, the factory's efficiency, flow and problems, the work in progress,
and the alerts, Asks and problems. The pages stay in the design language of `docs/design.md`.

Open `index.html`. Each page has a State control (Busy, Quiet) and a Theme control. Not built.

Rebuild with `bun docs/mocks/status-redesign/build.ts`. `build.ts` draws each page with the helpers of `ui/views/lib`
and copies `ui/app.css`. `mock.css` holds the parts the design language does not have yet. `snapshot.ts` wrote
`data.json`.

## Reader and decisions

- **Reader:** Chris, many glances a day and once each morning.
- **Decisions:** "Does anything need me now?" and "Is the factory doing useful work, and what is wrong with it?"
- **Kind:** Status (`aleph:datavis`, step 1). The page holds few numbers, each beside its usual value, with problems
  first. A breakdown that answers "why" goes one click down.

The 11 rounds of `docs/mocks/status-panels` arranged analysis panels: a stage table, agent time, week counts. These
pages order the blocks by the two decisions.

## Suggestions

1. Order the page by the two decisions: what needs Chris, then how the factory does and what is wrong with it.
2. Make each scorecard card the headline of one block below it, and link the card to the block.
3. Add a Problems block. Today's page has no place for a thing outside its usual range.
4. Draw the idle state too. The factory is idle for most of a day, and a page that needs a full factory fails then.
5. Give Events a filter by kind and a search.
6. Move analysis one click down: the stage table, the Active Issues chart, the Herald's Active and Inspector tabs.

## What the three pages share

| Block | Shows | Rule |
|---|---|---|
| Head | The time and the status sentence. A problem with no Ask reads "Warning: OpenRouter has no credit." Today a warning follows "Everything is fine; ". | `docs/design.md`, Page head |
| Scorecard | Six metric cards. Each is the headline of one block and links to it. | `aleph:datavis`: at most 7 headline metrics |
| Needs You | The alert and each Ask, with its actions and its Always button. Nothing when nothing waits. | `PRINCIPLES.md`: what waits for Chris shows at the top, with no scroll |
| Problems | New. What the factory sees outside its usual range: a word in its tone, the value, the usual value. | Principle 3; `aleph:datavis`, step 4: each number has a comparison |
| Active work | The issues that run, and the issues that wait with what they wait on. One form per page. | `aleph:datavis`: an item beside the typical item of its kind |
| Events | A filter by kind (Problems, Landed, Asks, Holds) and a search by ID or title. One form per page. | `docs/design.md`, Table: an event log puts the time first |
| Efficiency, Flow | Agent hours by outcome, lost time by cause, failed runs by stage, the week's counts, time by phase, landed per day. | `aleph:datavis`: a count beside each rate, p50 and p90 for a duration |
| Memory | The start context against its budget, six counts under the Memory page's names, offers per day. | `aleph:datavis`: two views show one name with one formula |
| Lights | Workers, tick, CI, suite, backend and vault, each with a word. | `docs/design.md`, Status light |

The scorecard:

| Card | Numbers | Compared to | Chris acts when |
|---|---|---|---|
| Needs You | items that wait / the oldest wait | 0 | it is not 0 |
| Working | issues that run / issues that wait / jobs in error | the 5 workers | issues wait while a worker is free |
| Efficiency | share of agent hours that reached main / hours lost | the baseline of `/api/flow` | it falls: read Lost Time by Cause |
| Lead Time | p50 / p90 from filed to landed | the baseline of `/api/flow` | p90 grows: read Time by Phase |
| Usage | the week's quota used / the week gone | the pace mark on the meter | used passes the pace |
| Memory | the aleph start context used | its 6,000 B budget | it reaches 95%: trim a core line |

The Problems rows, each with a rule that is a sketch:

| Row | Rule | Source |
|---|---|---|
| backend | a backend hold exists | `/api/automation`, `backend` |
| holds, land, cost | the monitor's day against its trailing days; 3 of its 6 findings of 11/20, picked by hand | `/api/factory`, `factory.monitor` |
| rerun | an issue with 2 or more returned or failed Implement runs in the window, and no Ask | the events |
| hold | 2 or more issues wait on one file | the events |
| a stage | 3 or more failed runs, at 1.5 times the stage's 7-day share; no stage met it in either state | the events; `/api/flow`, `stages` |
| memory | a start context at 95% of its budget | `/api/memory`, `start` |

An issue with an Ask shows once, as its Ask.

## The three pages

| Page | Order | Active work | Events |
|---|---|---|---|
| A · Briefing, `a-briefing.html` | Main column: Issues in Motion, Events, Memory. Rail: Problems with the alert and the Asks, Efficiency, Flow. In one column Problems leads. | C's lanes of the issues that run now, then a Waiting section in the same card: the waiting issues by what they wait on. | C's log table. |
| B · Board, `b-board.html` | Attention, Pipeline, then Events beside Efficiency and Memory. | A board: a column per stage with the week's median and failed share in its head, and the issues in it now. | The Herald feed in a card. |
| C · Timeline, `c-timeline.html` | Left: Issues in Motion, Events. Right: Needs You, Problems, Factory, Memory. | Lanes: each issue of the last hour on one time axis, its runs as bars in the tone of their result. | A log table of one event a row: time, event, issue, title, job, by, model, cost, took. |

Where each block sits at 1600 × 1000 px, in px from the top of the page:

| Page | Busy | Quiet |
|---|---|---|
| A | Problems 285 to 696 in the rail, lanes and Waiting 285 to 999, Events from 1023 | Problems 285 to 563 in the rail, lanes 285 to 506, Events from 530 |
| B | Attention 285 to 600, Pipeline 624 to 1109, Events from 1133 | Attention 285 to 541, Pipeline 565 to 836, Events from 860 |
| C | Needs You 285 to 810, lanes 285 to 826, Problems 834 to 1026, Events from 850 | Problems 285 to 540, lanes 285 to 506, Events from 530 |

## Recommended: A

- A shows Needs You, Problems and all of Now above a 1000 px fold in both states. In the first draft the three
  waiting items were 473 px of cards in the main column and pushed Now to 997 px. So they lead the rail, where the
  live Herald pins its Asks.
- The Now table gives each run its comparison: the elapsed time against the median and the p90 of its stage. The
  lanes of C show a duration with no usual value.
- The factory is idle for most of a day. Idle, A's Now card is 90 px. B draws five empty columns in 271 px. C's lanes
  show three issues that landed 9 hours before, which Events also shows.
- A needs only the small parts under New parts. B also needs the board, and C puts the timeline on a list page.

C's lanes show an issue that loops: a3418 passed, failed at land and started again, all in 14 minutes. A table row
hides that. A way to keep it is a second form of the Now card.

## Round 2: Chris's notes on A, 2026-11-23

1. The alert and the Asks are the first rows of Problems, tinted in their tone, with their actions. Needs You is gone. The
   status lights move to the Problems head.
2. C's Issues in Motion replaces Now. The waiting issues keep their table in a Waiting card under it.
3. C's event log replaces the Herald feed, in the main column.
4. Efficiency and Flow move to the rail. Memory stays at the end of the main column.

Round 3, the same day:

1. Waiting is a section under the lanes, in the Issues in Motion card.
2. Memory moves to the rail, stacked: the six counts in three columns, then Start Context, then Offers per Day.

Round 4: Problems moves to the top of the rail. At 1100 px and under, the page is one column and Problems leads it.

Round 5: the lanes show only the issues that run now. Idle, the card shows "No data".

Round 6: Memory returns to the end of the main column as the split card of round 1. The status lights leave the page.

The Recommended section is of round 1.

## New parts

Each needs a place in `docs/design.md` before a build.

- A meter fill in the need tone (`.m-need`): a run past its p90, a budget at 95%.
- The Problems table: a hand cell of what the problem is and a muted detail (`.pwhat`, `.pdetail`).
- An alert or an Ask as a Problems row: a tint and an edge in its tone, its actions under its text (`.palert`, `.pacts`).
- The "Warning: " head of the sentence.
- A row of status lights (`.lights`), and the filter row of the event viewer (`.evbar`).
- The column charts are hand SVG (`.cols`). A build draws them as `<aleph-chart>` panels.
- B only: the board (`.board`, `.bcol`, `.bitem`), and a small link button in a table row.
- C only: the timeline in a card on a list page. `docs/design.md` gives the Timeline to detail pages.

## Data

- **Quiet** is the live state of 2026-11-21 11:07 Pacific. **Busy** is the factory at 2026-11-20 11:05 Pacific, read
  back from the events: 7 live jobs on 6 issues, 5 issues that wait, 961 events in 2 hours, 32 issues landed that day.
- The week's figures (the scorecard, Efficiency, Flow, Memory, the usual values) are those of 11/21 in both states.
- The three waiting items of the busy state are real items of 11/20, shown together. CI on main failed 2 runs in a row
  from 17:45 UTC. The director escalated a3397 at 18:10:11 UTC and Chris answered at 18:11:55. It escalated a3359 at
  06:00:23 UTC. Not all three waited at 11:05.
- The busy lights are set by hand, except CI. The busy tick time is the minute before the state.
- The busy feed groups the events by issue with a rule simpler than `heraldRows()` of `ui/herald.ts`. The quiet feed is
  the live Herald's rows.
- The events of four issues that `/api/issues` does not list are left out. No job is in error in either state.

## Open

- No API serves the Problems rows. The rules and their thresholds are a sketch.
- At the snapshot `/api/automation` reports a backend hold (OpenRouter, HTTP 402, insufficient credits). The live
  Status sentence reads "Everything is fine." and only the Automation page shows the hold.
- Offers per day are 0 on 11/20 and 11/21. The recall log's last line is of 11/19 17:44, and since `f4df41a5` (11/19)
  factory agents run with no vault context. The offer figures of the Memory block need a new source, or they go.
- The elapsed meter reads the Implement and Land p50 and p90 from `/api/flow` `phases`. Intake and Review have only the
  p50 and p95 of `agents.roles`.
- The Herald sends grouped rows. The event filter, the search and the log's pages need an API that serves them.
- The page drops the stage table, the Active Issues chart and the Herald's Active and Inspector tabs. They need a
  place one click down, or they go.
- The mocks use one project. A second project needs a column or a group in Problems, Now and Events.

## Checked

On the files of `e0cb9b2a`, in Chromium at 1600 × 1000 px, on 2026-11-21:

- Each of the 3 pages shows, in both states, the right sentence and 6 cards, with no duplicate ID, no horizontal
  overflow and 0 console messages.
- A: the feed holds 25 rows. The Landed filter leaves 9 and Problems leaves 1. A search for "herald" leaves 4. A fold
  opens 5 lines.
- B: the feed holds 16 rows. Landed leaves 2, Problems 0 and "herald" 4. A fold opens 5 lines.
- C: the log holds 18 rows. Landed leaves 0, Problems 2 and "herald" 4. A filter acts only on the rows in the page.
- The State control switches the sentence on all three pages.
- At 900 px, A and C keep Needs You first and do not overflow.
- A and C draw with no fault in the dark theme.

On the same files, from a one-off server, in Chromium on 2026-11-21 at 12:00 Pacific:

- B draws with no fault in the dark theme at 1600 × 1000 px, in both states: 6 cards, no duplicate ID, no horizontal
  overflow, 0 console messages.
- At 900 px, B keeps Attention first, draws the board as 2 columns and does not overflow the page, in both states.
- Defect, B at 900 px, Busy: the Attention table is 643 px wide and its card gives it 610 px. The last 33 px hold most
  of the right action button of a row (CI run, Drop). A scroll inside the card reaches them. The table fits at
  1000 px and above, and in the Quiet state at 900 px. Not fixed.

The action buttons do nothing.

## Next

Chris picks one: A as drawn, A with C's lanes as a second form of the Now card, or B or C. The build is then filed as
an issue. http://aleph.home/#/issues/aleph/3452 covers the backend hold that the Status sentence does not say.

His notes arrive on the shelf item `20261121-194453-v4ql`, and `shelf wait 20261121-194453-v4ql` receives them. The
pages of that item are the pages of `e0cb9b2a`.
