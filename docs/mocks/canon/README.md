# Canonicalize mock

Request (Chris, 2026-11-20): select a UI component, have an agent pick out its salient features and generalize them,
approve or deny each, apply the result to similar controls on other pages, and browse the design guide. "Mock or
illustrate the whole thing as much as possible."

The pages come from `gen.ts`, which uses the real UI helpers (`ui/views/lib/html.js`, `ui/views/lib/timeline.js`) and
`ui/app.css`. Rerun with `bun docs/mocks/canon/gen.ts`. `mock.css` holds only the mock's own parts. The annotate widget
is drawn by hand, after `~/aleph-tools/annotate.js`.

## Pages

1. `index.html`: the loop and what stays fixed.
2. `1-select.html`: annotate mode on Status; the Show toggle outlined; a new quick action **Canon** (key C).
3. `2-extract.html`: the note thread, the source, the computed style mapped to tokens, the DOM, both themes.
4. `3-review.html`: the shelf item. Each feature is classed as matches, new or conflicts, with Keep, Drop or Edit.
   It also shows the doc diff and the specimen that Approve writes.
5. `4-apply.html`: the matches, exact and similar. It shows the deviations of each, the fix pick, the job's before and
   after, and the code diff.
6. `5-guide.html`: `#/design` as the guide browser, with contents and off-canon counts, one entry, and hover-to-see-canon.

## Decisions

- **Example control.** The Show toggle of the Herald card (`ui/views/now.js:212`), a `seg()`. `docs/design.md` has no
  Segmented control entry: its rules sit in Filter bar and Tabs, so the canon is new and the case is real.
- **Request is a note.** Canon is a fifth quick action beside Delete, Move, Refit and Explain, so the request lives in
  `~/.aleph/annotations.json` with the others. No new store.
- **Review is a shelf item.** It uses the shelf's reply and resolve, as `aleph:mock` does.
- **Doc stays the source.** Approve writes a `docs/design.md` section in the doc's own part-table form (Card, Filter
  bar) and a `spec()` on `#/design`, which already reads its rules from the doc.
- **Canon names one helper.** Apply moves look-alikes onto `seg()` and a new `wireSeg()`, so a later change is in one place.
- **Similar matches need a yes.** Exact matches are call sites of the helper. Similar ones come from a crawl by DOM
  shape and computed style, so each needs Yes before a fix. The KPI tile row shows a false match.
- **Conflicts are explicit.** A feature that breaks a rule shows the rule and the result of Keep and of Drop.
- **Guide counts drift.** Each entry in the contents shows how many controls are off its canon (`badge error`).

## Open

- How the crawl decides "similar": the threshold and which pages it visits.
- Whether a canon of a widget in `~/aleph-tools` writes to this repo's doc or to that repo's.
- The counts on the guide page need a stored map of control to canon. A re-crawl on each land could keep it fresh.
