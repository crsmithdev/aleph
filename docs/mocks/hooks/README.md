# Hooks page mock

Request (the user, 2026-11-19): "mock up a hooks page for aleph, in the 'claude' section of the sidebar", after a
review of the past week's Stop-hook holds and hook errors.

`index.html` is drawn by `gen.ts` with the real UI helpers (`ui/views/lib/html.js`, `ui/views/lib/timeline.js`) and
`ui/app.css`, so its markup is the app's. Rerun with `bun docs/mocks/hooks/gen.ts`. The data is real: `holds.json` and
`errors.json` come from the hook entries of the transcripts in `~/.claude/projects` for 2026-11-12 to 2026-11-19.

## Decisions

- **Place.** `#/hooks` under Claude, after Memory, with the `plug` icon. The sidebar markup is the router's
  (`ui/views/lib/router.js`, the `head` and `aria-current` items).
- **Page shape.** Page head, KPIs, then folds, as the Skill page (`ui/views/skills.js`): `pageHead`, `renderKpis`,
  `detailPanel`. One page, no tabs.
- **KPIs.** Holds, Caught, False, No Effect, Errors. A hold's worth is what it caught against what it cost, so the
  page leads with those (datavis: each number has a comparison).
- **Holds by Hook.** One row per hook and kind, with Interactive and Workers counts and the outcome as one `meter`
  per row (`meter`, `legendHtml`). Outcome colours use the tokens `--done`, `--muted`, `--error`, `--need`, `--rule`;
  the six `.o-*` classes are new and local to this mock.
- **Outcomes.** Caught (the agent corrected a claim or fixed code), Handoff (context gate), Held up (the rerun backed
  the claim), False (not this session's change, or the gate was wrong), No reply, No effect (a worker or headless
  session that had already returned). The classes come from a keyword pass over each hold's first reply: a guide, not
  a measurement.
- **Holds by Day.** A `barList`, the largest day marked `top`, as the app's bar lists do.
- **Errors by Cause.** Grouped by cause, not by hook, because one cause (a moved file, a removed worktree) breaks many
  hooks at once. Each row names its fix.
- **Hooks.** The inventory from `hooks/hooks.json`, with a Workers column (`runs` or `skips`) and this week's holds.
- **Holds log.** An event log, time first (design: event logs lead with time), with a `filterBar`: Who (`seg`),
  Hook, Kind and Outcome (`select`). The mock holds every row and hides the ones the filters drop; the app would page
  them. A hook name in Holds by Hook, or Show holds in a hook's row, sets the filters. Session ids link to
  `#/sessions/<id>`.
- **Hook detail page.** the user chose a detail page over an inline row (2026-11-19). A hook's name in the Hooks table
  opens `#/hooks/<event>/<name>` (in the mock, `hook-<event>-<name>.html`). It has a crumb, the hook's facts
  (`facts`), KPIs of its outcomes, Holds by Kind (a kind's name filters the log), Holds by Day, the holds log with Who,
  Kind and Outcome filters, the errors of causes that hit it, and its source: the entry file and the local files it
  imports, one level down, each a fold. A hook with no data shows `empty()`. A `cli/` hook's source reads "The whole
  CLI", because `cli/cli.ts` is the whole CLI. The Skill page (`ui/views/skills.js`) is the model.
- **Notice.** One line on the refit hook change of `d90a0602`, so the week's refit numbers read as before that change.

## Open

- The data comes from transcripts. A live page needs a source: Langfuse has the verify gate's spans and scores, but
  not the refit or context gate's, nor hook errors.
- Workers counts include 10 holds from other headless sessions (`maintainer-compile`, `aleph-next`, a probe).
