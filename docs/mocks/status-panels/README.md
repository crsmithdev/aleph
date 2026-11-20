# Status panels mocks

Chris asked on 2026-11-20: combine Pipeline, Agent Time and Active Issues into two panels, each the size of Agent
Time, and use the space left for a panel of memory stats, issues and needs.

`build.ts` draws each board. `parts/` holds the live Status page's rendered HTML (scorecard, Agent Time, Pipeline,
Herald) of 2026-11-20, and `data.json` holds the live `/api/flow`, `/api/issues`, `/api/factory` and memory numbers.
Rebuild with `bun docs/mocks/status-panels/build.ts`. Not built.

At 1600 px, Agent Time is 216 px tall and the three cards fill 806 px. Two panels of 216 px and two 24 px gaps leave
326 px for the new panel.

Round 2, on Chris's notes: the new panel becomes Memory, with memory content only, and Agent Time and Pipeline are
redrawn as one panel. Active Issues is the second panel. Round 1 (A1, A2 and the Attention panel) is in git history.

| Board | File | Shows |
|---|---|---|
| B1 | `b1-implement-opens.html` | The pipeline row, with Implement opened into a wide block that holds Agent Time: share reached main, the outcome bar and its hours. The other stages keep 44 px rings. |
| B2 | `b2-stage-rows.html` | One row per stage: runs per issue, p90, failed share and agent hours on one scale. Implement's bar is the outcome bar. The share reached main moves to the head. |

| C1 | `c1-split.html` | Round 3, on Chris's notes: one panel split 7 : 2 (587 px and 168 px at 1600 px). The live Pipeline rings on the left. Three metric cards on the right: reached main (68%, 54h of 80h, with the outcome bar), first run landed (69%, 189 of 273) and failed runs (18%, 279 of 1,519). |
| C2 | `c2-rows-stats.html` | Round 4, from Chris's sketch: B2's stage rows on the left, a rule, and three stats on the right, split 3 : 1 (581 px and 194 px at 1600 px). The outcome legend moves to the Pipeline head; the stats drop C1's card boxes. |
| D1 | `d1-filed-closed.html` | Round 5: C2's Pipeline; Memory cut to 216 px; Active Issues at half width beside Filed and Closed per day, with the net backlog change (−129 in 6 days). |
| D2 | `d2-lost-causes.html` | Round 5: as D1, with Lost Time beside Active Issues: the 26h of lost time by cause, largest first. |
| D3 | `d3-issue-counts.html` | Round 5: as D1, with an Issues panel of six week counts: filed 573, intake 231, landed 273, dropped 270, open 5 (+ 6 parked), errored 0 now. |
| E1 | `e1-gates.html` | Round 6: D3, with the right of Pipeline holding the gates: 240 holds in 7 days (19% useful), and one way, verify gate and context gate with their holds split into useful, held up and wasted. |
| E2 | `e2-issue-holds.html` | Round 7: as E1, with the right of Pipeline holding the dispatch's 10 issue gates (`GATES` in `jobs/lib/gates/issue-decision.ts`): 119 issues held this week; after, full, red and file as bars of issues and hours; job and done in a note (they do not stop a start); paused, waiting, credit and ask held none. |
| F1 | `f1-holds-table.html` | Round 8: the right of Pipeline as held issues (119) over a table of gate, issues and hours. Active Issues and Issues join in one split panel. |
| F2 | `f2-holds-bar.html` | Round 8: held issues (119, 140h held) over one bar split by gate, with a legend of counts. Same joined Issues panel. |
| F3 | `f3-holds-figures.html` | Round 8: two figures, held issues (119) and hours held (140h), then the gate that held most (after: 77 issues, 133h). Same joined Issues panel. |
| G1 | `g1-worst-of-each.html` | Round 9: the right of Pipeline as the week's three biggest problems, one of each kind: the stage that fails most (Implement, 43%, 228 of 531 runs), the cause that loses most agent time (stalled or timed out, 9h, 35%), and the gate that holds most (after, 77 issues, 133h waiting). |
| G2 | `g2-top-costs.html` | Round 9: one ranked list in hours: lost agent time by cause and hold hours. Hold hours are waiting, not agent time, so after (133h) tops a list where the agent causes are 9h and less. |
| H1 | `h1-counts-speed.html` | Round 10: the six issue counts move to the right of Pipeline. The right of Issues shows speed: lead time (p50 26m, p90 5h 27m) over a table of each phase's p50 and p90 from `/api/flow` `phases`; the slowest p90 (Intake, 21h 55m) is marked. |
| H2 | `h2-speed-chart.html` | Round 11: as H1, with the right of Issues as a chart: per day, the median minutes of intake, queue, implement and land for the issues that landed that day, stacked, in the colours of Active Issues. Medians keep Intake's 21h tail out. A day over 30 minutes is cut at 30, marked with a break and labelled with its total (Tue, 95m: the queue median was 77m). |

The joined Issues panel splits 3 : 1 as Pipeline does: Active Issues on the left, a rule, and the six week counts of D3
on the right in two columns.

Boards A to C draw Active Issues alone at 216 px and the same Memory panel at 326 px:

- **Start context:** bytes left in aleph, a bar per scope, and the three core lines to trim first (0 offers in 8 days).
- **Notes:** offered in 7 days, never offered, unoffered reads, lint refused, re-check due, writes in 7 days.
- **Offers per day:** the 10 whole days the recall log holds, then when the maintainer last ran and that it ran dry.

## Why Agent Time sits in Implement

The outcome classes count 541 runs (273 landed, 133 returned, 3 failed, 110 reran, 25 dropped). The build and recheck
stages hold 544 runs. So Agent Time is the time of the implement jobs, and both boards draw it there.

## Open

- H2 reads `/api/flow` `times` (one row per issue) and buckets each landed issue by its land time, in Pacific days.
  Today has no landed issue at the snapshot, so it has no column. No API serves the daily medians yet.

- H1's lead time repeats the Completion tile of the scorecard (25m 36s / 5h 27m).

- E2's numbers come from `holds.ts`, which reads every hold record through `allHolds()` and counts the week by the rule
  of `holdRows` in `jobs/lib/learning/monitor-table.ts`. No API serves them yet. The 119 held issues also count 4
  issues held by parent, starting and looping, which are not in `GATES`.

- E1 reads `/api/hooks?window=week` (240 holds). It groups the Hooks page's outcomes: useful is caught and
  handoff, held is held up, wasted is false, no reply and no effect. One way wastes 83 of its 106 holds, nearly all
  no effect on workers.

- D3's filed (573) and dropped (270) count `/api/issues` by created and closed time since 2026-11-13 16:47 UTC.
  `/api/flow` gives 508 filed for the same week by its own rule. Intake (231 issues) and landed (273) come from `/api/flow`.
  Errored is the live count of errored jobs (`/api/factory` `errored`).

- D1 counts issues by their created and closed times in Pacific days. Today is left out because it has no
  issues yet at the snapshot (08:47).
- D2 sums the causes of the lost classes (failed, reran, dropped): 25.65h, against 25.64h of lost time in `/api/flow`.
  Causes under the top four fold into "Other causes" (4h).
- Memory at 216 px drops the trim list and the offers spark.

- C1's first run landed is the "First run of the job" cause of the landed class: 189 of 273 runs. `/api/flow`'s
  `figures.firstPass` gives 66%, by a rule this mock does not use.
- C1's failed runs add the failed runs of Intake, Implement, Review, Recheck and Land; Director and Monitor stay out.

- B2 gives Intake, Review, Recheck and Land their hours as runs times mean minutes from `/api/flow` stages. Implement
  uses the 80h of the outcome classes, which is more than the 59h that runs times mean minutes give for build.
- Queue has no agent time; both boards show its p90 wait only.
- The Active Issues chart loses its form switcher (area, bars, lines).
