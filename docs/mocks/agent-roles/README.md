# Agents roles table mocks

Request (the user, 2026-11-15): redesign the Roles table on the Agents page. Show one standard set of data for every
agent type, instead of worker and reviewer columns that apply to half the rows. Handle several models per size or
role, now and in the past (maybe rows that expand). Let every size be turned off. Mock a few alternatives.

Serve this directory and open `index.html`. The bar at the top switches the layout. `data.json` is the real month of
runs to 2026-11-15, grouped by role, size and model, from the run ledger. `app.css` links to `ui/app.css`.

## Layouts

| Layout | What it does |
|---|---|
| A · one table | Every size and role on the same columns. One Output column carries the role's own noun: landed builds, verdicts, triages. ▸ opens the earlier models of a row. |
| B · workers + roles | Two tables. Workers keep the build columns (Landed, First pass, Review pass, $ / landed). Roles get only the shared columns. ▸ opens earlier models. |
| C · settings apart | The toggles and model selects move to one Models list, as `design.md` asks. The table has one row per agent and model, with a Now / All models switch. |

## Decisions in the mock

- Shared columns for every row: Runs, OK, Stuck, p50, p95, Cost, and cost per output.
- OK is a run that did its job. A reviewer's OK is a verdict given, pass or return.
- The reviewer's pass share moves to the worker rows as Review pass, because it judges the build.
- Per output is cost over the role's noun: $ per landed build, $ per verdict, $ per triage, else $ per run.
- A size row shows the model it uses now. Earlier models in the window are sub-rows with their first and last dates.
- Builds with no size are one Unsized row, because 837 of 2,892 builds in the month have no size.
- Every size has an on box. An off size sends its work to the next size up. Large off sends it down to Medium.
  The last size that is on cannot go off.
- Every role has a model select, the housekeeper and the maintainer too. The housekeeper has no model setting
  today and always runs on opus (a-03167).

## Open

- Large off needs a code change. `jobs/lib/routing/models.ts` lets only Small and Medium go off, and
  `jobs/lib/routing/route.ts:31` finds no size when Large is off and the choice is Large.
- Output nouns other than landed and verdict are runs that ended OK. Intake triages and director steps are not
  counted on their own yet.
- Data defects seen in the mock: runs with no model (a-03164), and first pass at 99% against review pass at 81% on
  Medium (a-03165).
