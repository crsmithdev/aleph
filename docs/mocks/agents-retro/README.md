# Agents page retro mock

Request (Chris, 2026-11-16): show the findings of the refit-design retro of `#/factory/agents` rendered in the
design language itself, not as abstract diagrams.

Serve this directory and open `index.html`. Each section draws a part of the page twice: Now, then Fixed. The
numbers are the findings of the retro report (`/tmp/refit-design-retro-2026-11-16T17-55-26-113Z.html`).

## Decisions in the mock

- Now is the live page's own markup, captured from `#/factory/agents?window=week` on 2026-11-16, on `ui/app.css`
  (`app.css` links to it). Failed states come from `/api/flow` and `/api/models` routed to 500.
- Fixed applies each fix to that markup: `badCount()` on Stuck, `span.quiet` for `span.m`, `Per Output`, no
  First pass aside, `Could not load the agents.` with no hint and the status in Technical details,
  and `notice()` when the models fail.
- CSS fixes sit in the page's style block, scoped to `.fix`: the error line in `--stuck` inside a card, the fold
  mark in a fixed gutter, and a trend that wraps under a metric card key.
- Metric cards (decided by Chris, 2026-11-16): the spinner sits at the upper right while a figure waits. A failed
  fetch leaves a still `--stuck` ring with `!` in that spot, with the error line as its title. Line 2 keeps its
  height and shows no `–`, because a dash does not tell no data from no API.
- Error cards have no hint line: "Check that aleph-ui is running, then reload." is never used (Chris, 2026-11-16).
- `options.html` draws two choices on the live markup, A beside B. Chris picked B for line 2: the second value
  stays .62em, in the strong weight and `--ink-2`. For hints, every hint goes, the Langfuse ones too, with the
  upstream text in Technical details ("line 2 is b, others is fine").
- Sizes off (14, 16) are drawn from the code, because the live data has all three sizes on.
- The charts need ECharts, so Now shows screenshots of the live charts. Fixed shows only the legends, drawn with
  the chart tokens: one colour per model in every window, one key per short name, six roles and `Other`, wrapped.
- Group row 15 shows `Other Roles` as a placeholder. Chris named it `Other` (2026-11-16).
- The fix for 17 is a non-breaking hyphen plus a trend that wraps. The hyphen alone pushed the trend out of the
  card.
