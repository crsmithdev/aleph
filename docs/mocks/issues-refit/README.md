# Issues page refit mock

Request (Chris, 2026-11-16): refit the Issues page (`#/issues`). Rework the metric cards so the store's total does not
dominate, and drop Open Age and Jobs. Rethink the charts and drop Tests. Find a way to file an issue that takes little
space, other than a draft issue page. Show one ID form, `a1234`. Put the sub-issue fold button at the far left with
the columns still aligned. Priority chip colour is out of scope (Chris: "skip for now").

`index.html` is built by `build.ts` with the real kit helpers of `ui/views/lib/html.js` and `format.js`, from a
snapshot of `/api/issues` taken on 2026-11-16. The snapshot is not committed. To rebuild:

```bash
curl -s http://aleph.home/api/issues > docs/mocks/issues-refit/issues.json
bun docs/mocks/issues-refit/build.ts
```

`app.css` is a copy of `ui/app.css` from the same day. The charts are inline SVG stand-ins for `<aleph-chart>`.

## Decisions

| Part | Decision | Rule it follows |
|---|---|---|
| Cards, option A | Active, Backlog (open + parked, trend vs a week ago), Net (filed − closed), Close rate (points trend), Time to close (p50 / p90) | design.md Metric card: `v2` with `q`; `cardTrend` `points` for a share, `relative` for a count or time |
| Cards, option B | Backlog / active, Filed per day, Closed per day, Time to close | Same; per-day rates keep one scale across windows |
| No store total | The `/ 1,823` second value is gone | Request: the total must not dominate |
| Charts | Filed and Closed by Day (columns), Time to Close by Kind, Backlog by Day (area), Net Change by Day (diverging) | design.md Chart panel: "Show one measure on one value axis. For two measures, use two panels." Flow opens as Columns, level as Area |
| Net change colours | `need` when the backlog grows, `done` when it shrinks | design.md Chart panel: a state takes the colour of its tone |
| Backlog split | One series, no priority split | 3 of 137 open or parked issues are high or critical; the store keeps no parked history |
| Fold column | Its own first column, empty on rows with no parts | design.md Table: "the row's fold button, id or name, title, …" |
| Labels | Two chips, then `+N` with the rest in a `title` | design.md Table: title cell "takes the spare width"; other cells do not wrap |
| IDs | `a3202`, `at3201`, `j9739` everywhere, from `idLink()` | design.md Link: `idLink("a1700", …)` |
| Filing | F1 search-to-file (recommended), F2 head line, F3 drawer, F4 paste | Principle 5: one path; design.md Principle 6: terse |

## Open

- Pick card option A or B.
- Pick Filed and Closed columns or Net Change for the flow chart.
- Pick one filing option. F1 and F2 file a title only, so intake runs before any text exists.
- The `interview` project's code `i` is also the letter of an issue key with no code.
