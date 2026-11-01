# Status redesign

Chris chose board E with E1, E2 and E3 on 1 Nov 2026. The inspector (E4) is not part of this work.

The mocks are in `2026-11-01-status-redesign-mocks/`. They are design files: read the markup and the CSS, and do not load them in the UI. Published canvas: https://claude.ai/artifact/JPurpcRzZpocmm6MS1nNR7

| Page | Mock | Route |
|---|---|---|
| Status | `EStatus.dc.html` | `#/` |
| Performance | `EPerformance.dc.html` | `#/status/performance` |
| Efficiency | `EEfficiency.dc.html` | `#/status/efficiency` |
| Capacity | `ECapacity.dc.html` | `#/status/capacity` |

## Rules for all parts

- Numbers in the mocks are a snapshot from before the 935 fix, and items marked `sample` are made up. Every number on a page comes from `/api/state` or `/api/speed`.
- Colours become page tokens in `ui/index.html`, not hex values in views. The mock values set the dark theme, and this includes `--bg` at `#202331` for every view, because the shell is shared. The light theme keeps working with values that match.
- Fonts stay Merriweather and Work Sans through the existing tokens.
- The UI stays without a build step. Charts use ECharts through `chart()` in `ui/lib.js`, and bars that the mock draws in HTML stay HTML.
- Each page works at phone width with no horizontal page scroll, as the mock's media query does.
- The sidebar shows Performance, Efficiency and Capacity as indented links under Status.

## Fixed

- `/api/state` and the data flow do not change, except where a part says so.
- `/api/events` and the 60 s reload stay for Status. Awaiting-you actions (Land, Send back, Always, Answer, Drop, Re-check) and the Pause and Resume button keep their current behaviour.

## Changes from the current page

- The Hour, Day, Week and Month picker goes. All pages show 7 days and compare with the last 24 h, which come from `/api/speed?window=day`.
- The flow strip and the Incoming lane leave Status. Inventory lists new issues.
- The phase cards with charts leave Status and move to Performance as tiles and a histogram.

## API additions

`/api/speed` adds to each `phases[k]`: `hist`, the count of times in 7 bins (under 1m, 1–5m, 5–15m, 15–30m, 30m–1h, 1–4h, over 4h), and `worst`, the longest time in seconds. The mock's list of slowest issues is left out, and the card keeps its "Longest" line without the sentence about the API.

## Where each mock value comes from

| Value | Source |
|---|---|
| Lost time | `lost` |
| Lead time | `phases.lead`, `buckets[].lead` |
| First pass | `issues.firstPass` |
| Lands | `done`; the mock's second count (land runs) is `kinds.land.count` |
| Weekly usage, pace | `usage.now`; the share of the week gone comes from `seven_day_resets_at` |
| Causes | The `causes` of the Late, Restarted and Dropped classes, merged by name and sorted by hours |
| Reruns | `flaky` |
| Fix rounds | The `fixed` class: runs, hours, issues |
| Usage per issue | `issues.week`, with `weekText` |
| Checks, models | `checks`, `models` |
| Agents live, roles | `agents` |
| Runs today, day cap | `factory.runsToday`, `factory.dayCap` |

Recorded cost for the day is not in this table. If `/api/state` does not hold it, add it in the Capacity part.

The "File an issue" button posts to `POST /api/issues`, with the cause as the title, and the runs and reasons as the body.
