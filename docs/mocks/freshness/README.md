# Data freshness

Request (the user, 2026-11-23): show how fresh a page's data is. The pages are the live page's rendered HTML of
2026-11-23 (`parts/`), with the age added by `build.ts`. Run: `bun docs/mocks/freshness/build.ts`.

## Pages

| Page | Shows |
|---|---|
| `a0-heads.html` | The four Jobs heads of variant A, stacked |
| `a1-live.html` | A: the stream is open on a live view: `live` |
| `a2-aged.html` | A: no stream, or a view that is not live: the age, `4m` |
| `a3-rebuild.html` | A: the old answer over a rebuild: `updating`, muted |
| `a4-failed.html` | A: the build failed: `error`, in the error tone |
| `b1-panels.html` | B: Memory Health is live, and one panel is `6m` old |

Hover the word for its tooltip: the mark's line (`Jobs is 12m old: <error>`), when there is one, then each key of
the page with its build time.

## Decisions

- **One word.** The age is `live` or a span such as `4m`, as `be-terse` and `plain-text-states` ask (`design/rules.md`).
  The keys and times go in the `title` tooltip.
- **At the right of the head**, after the controls: the page head keeps its parts and order (`design/components/page-head.md`).
- **No tone for the age.** `meaning-is-tone` keeps a tone for a state. `live` is `--ink` with an open dot. An age is
  `--muted` in `--num` at `--fs-xs`, one size under the head's count.
- **No banner.** A rebuild or a failed build shows in the head word, not in the `#aged` notice (the user, 2026-11-23):
  `updating` stays muted, and `error` takes the error tone, as a failed build is a state. The `markLine()` text goes
  in the tooltip.
- **Variant B** puts the age in the panel's `.sh .aside`, before its form menu, only on a panel older than the page.
  This extends the chart panel rule that a panel tells how old its data is when it did not rebuild
  (`design/components/chart-panel.md`).

## Not decided

- Which keys feed which Memory panel. B1 puts `/api/memory/log` on Writes and Recalls as an example.
- The page needs `x-aleph-at` from the server for each key: the build time that `ui/updater.ts` keeps as `s.at`.
