# Herald redesign mocks

Request (2026-11-13): a design pass on the Herald, mainly how items and sub-items show, for efficient use of space,
consistency and readability. Mocks only; no change to the UI until a choice is made.

`app.css` links to `ui/app.css`, so the pages draw with the live tokens. `mock.css` holds the styles every page shares, `b2.css` the B2 rows, and `final.css` the final draft's additions.

## Pages

- `options.html`: the four first options: A Tighten, B One-line ledger, C Thread, D Rail.
- `b2.html`: B with A's guide line under each fold; a housekeeper run collapsed and expanded.
- `filter.html`: the filter options, chip click and group toggle, with status rows as old → new.
- `subjects.html`: each kind of non-issue subject as it shows today, with call signs (`HK57`) and with an `@` sigil (`@hk57`).
- `final.html`: the current draft. Running line fixed for type, status rows show the new text only, chips against
  words, chip filter on.

## Decisions

- B, the one-line ledger: time, action, ID, title on one line; facts move into the fold.
- A fold hangs on A's thin guide line, not in a grey box.
- A routine run with changes says only `N changes` when collapsed. Expanded, it lists one line per change: the verb,
  the issue and a bit about it (the comment, the new title or the reason). This needs `why` and `title` on each
  change in the housekeeper's event (`jobs/lib/roles/housekeeper.ts:247`).
- A status row shows only when the status text changes, and shows only the new text. No status row on page load.

- A status row has its tone's background with the text centred, the time after it.
- A scheduled run's action is `scheduled`, not the routine's own verb, which repeats its name.

## Open

- Short names for scheduled runs: call signs (`HK57`) or another pitch.

- Filter: chip click (option 1), group toggle (option 2) or both.
- Action as a chip or as a tone-coloured word; design.md's feed row spec says a word.
