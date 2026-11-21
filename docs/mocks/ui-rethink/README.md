# UI re-think

A re-think of how the seven sidebar pages present information: Automation, Agents, Issues, Jobs, Sessions, Memory and
Hooks. Status is out of scope, because another mock covers it (`docs/mocks/status-redesign/`).

Request (Chris, 2026-11-21): "a clean re-think of how information is presented on the ui, without constraints. I want
less clutter, better organization, easier access to the most important information, and for the layout to be as clean
and pleasing as possible."

## State

- Done: the audit of the seven pages, the design in this file, `snapshot.ts`, `data.public.json`, the kit
  (`build.ts`, `kit.ts`, `mock.css`, `mock.js`), the overview `index.html` and the Issues page.
- Not built: the views of the other six pages. Each `pages/<id>.ts` holds its registry entry and attention rows, and
  its views draw "Not built".
- Not committed: `data.json`. It holds session prompts and vault note text, and this repo is public. The `.gitignore`
  here keeps it out.
- Not verified: the values of `data.json` against the live API. The script ran once and wrote 284,083 bytes.

`bun docs/mocks/ui-rethink/snapshot.ts` reads the live UI API at `http://127.0.0.1:3020` and writes `data.json`. One
run takes more than 5 minutes, because `/api/issues`, `/api/jobs` and `/api/sessions` are slow.

## Data

`data.public.json` is the `data.json` that `snapshot.ts` wrote at 2026-11-21T19:45:55Z, with each private text
replaced. The filler has the length of the text it replaces, so a drawn row keeps its real width. Replaced:

- Session prompts: `sessions.yours[].prompt`, `sessions.yours[].turnList[].prompt` and `sessions.factory[].prompt`.
- Vault note text: `memory.notes.semantic[].text` and `memory.notes.working[].text`.
- Recall queries, which are prompt text: `memory.log[].why` of each `recall` row.
- The text of an issue from another repo: `request`, `spec`, `note.text` and `runs[].reason` where `repo` is not
  `aleph`.

Vault note titles, hold reasons and issue titles stay, because `docs/mocks/memory-v3/data.json`,
`docs/mocks/hooks/holds.json` and `docs/mocks/status-panels/data.json` show them already.

Two shapes matter to a builder. `issues.closed[].runs` is the list of runs for the first 12 rows and a count for the
others. A running run has a negative `secs`.

## What is wrong today

1. **One template for every page.** `docs/design.md` says "page head, metric cards, then cards". A browser, an
   analysis, a settings page and an inventory all open with 5 or 6 metric cards and 3 or 4 charts. The page's own
   content starts below the first screen.
2. **Pages mix kinds.** Automation holds settings, evidence, the monitor and an audit log. Jobs holds a timing analysis
   and a job browser. Sessions holds tool analysis, a session browser and two hook tables. Page heights at 1440 px:
   Automation 4238 px, Hooks 4162 px, Jobs 3131 px, Sessions 3108 px, Issues 2474 px, Memory Notes 15807 px.
3. **Equal visual weight.** Each block is the same white card. A problem is quiet: the OpenRouter 402 error is one
   line of muted text, and the 151 hook errors are one tile of five.
4. **Tables print defaults.** `medium`, `done`, `aleph`, `0` and `0d` fill the Issues table of 11 columns. Jobs repeats
   a title 3 or 4 times for one issue. Hooks shows a meter and the same 6 numbers beside it.
5. **Controls are heavy and scattered.** Automation has 10 Save buttons. Each chart has a toggle of 5 buttons. The 5
   dock buttons float over table columns.

## Decisions

Each decision names the rule behind it.

1. **The page named X opens on the list of X.** Issues opens on issues and Hooks opens on hooks. Rule: Principle 3,
   "Anything wrong or waiting for Chris shows at the top, with no scroll", and the request for easier access.
2. **Each page has at most three views, in one order:** the things, then the analysis, then the log or the settings.
   The views are tabs in the page head. Rule: `aleph:datavis`, "Keep status and analysis on separate pages".
3. **One attention row per problem, drawn only when the problem exists.** It uses a tone colour and names the action.
   Rule: Principle 3.
4. **A facts line replaces the metric cards on a list view.** It is one line of at most 4 figures at text size. An
   analysis view gets one band of at most 4 figures, each with its comparison. Rule: `aleph:datavis`, "at most 7
   headline metrics", and each figure needs a comparison.
5. **A row carries its evidence.** A job row draws its runs as a strip. A hook row draws its outcomes. A role row draws
   its success rate against the baseline. Rule: Principle 4, "A mechanism earns its place with evidence".
6. **A row hides its defaults.** No `medium`, no `aleph`, no zero, and a muted `done`. Rule: `docs/design.md`,
   Principles 5 and 6 (terse UI text).
7. **Row select opens an inspector at the right.** The detail pages stay, behind "Open page". Rule: Chris's wish of
   2026-11-20 to look into a hook "without a hook detail page". `.browse` and the Memory inspector exist already.
8. **A setting shows Save only after a change.** One menu replaces the 5 chart form buttons. The dock moves to the
   foot of the sidebar.
9. **The tokens, fonts and palettes stay.** The pages then sit beside the Status redesign. Only layout and components
   change.

## Page grammar

1. Page head: the title in the display face, the view tabs beside it, the scope control at the right. The scope
   control shows only on a view it changes.
2. Attention rows: none, or one per problem.
3. Facts line (list view) or figure band (analysis view).
4. List view: one surface with search, filters of one control type, and rows. The inspector sits at the right and
   stays in view. Under 1100 px the inspector goes below the list.
5. Analysis view: charts 2 across, then the tables behind them.

The first tab names the things the page lists. Where that is the page's own name, the tab reads "List".

## Pages

| Page | Views | Attention row (real data) | Moved or cut |
|---|---|---|---|
| Automation | Rules, Limits, Log | "OpenRouter: API Error: 402 Insufficient credits"; "Monitor, Nov 20: 6 findings", which opens in place | Memory Jobs moves to Memory. The 3 tiles become a facts line. |
| Agents | Roles, Usage | "Local model down: gpt-oss-20b" | The 3 charts and the usage tile move to Usage. |
| Issues | List, Flow | none | The 5 tiles and 4 charts move to Flow. Notes and Jobs columns are cut. |
| Jobs | Runs, Timing | none | The 6 tiles and the timing tables move to Timing. One row per issue replaces one row per job. |
| Sessions | List, Tools & Skills | "Sessions is 23h 29m old: a rebuild runs" | The Hooks and Verify-Gate Denials cards move to Hooks. |
| Memory | Notes, Health, Log | "Start context 5,950 B of 6,000 B"; "178 lint findings, 146 refused" | Notes shows one type at a time, in pages. |
| Hooks | List, Holds, Errors | "151 hook errors, 72 from a moved hook file" | One row per hook replaces the Holds by Hook table and the inventory. |

Detail of each list view:

- **Automation, Rules:** 10 rows. Each shows the ask, the count of fires, who decided (rule, director, Chris) as a bar,
  the result with no answer, and the mode. Limits holds the 7 caps, the 3 schedules and the held paths as setting rows.
- **Agents, Roles:** rows in three groups (workers, review and intake, oversight). Each shows the model select, the
  switch, runs, success against the baseline, p50, cost and cost per output.
- **Issues, List:** groups Open (1), Parked (6) and Closed. A closed row shows its cost and its time to close. The
  search box still files its text as an issue with Ctrl+Enter.
- **Jobs, Runs:** one row per issue with a strip of its runs. The width of a segment is its duration and the colour is
  its state. System runs (maintainer, monitor, housekeeper, director) are a second group.
- **Sessions, List:** opens on Chris's own sessions. Factory and headless sessions are a filter. The facts line splits
  the week's cost by who ran the session.
- **Memory, Notes:** search, one type at a time (semantic, procedural, episodic, working), and the inspector.
- **Hooks, List:** the 3 hooks that hold come first, then the other 24 by event.

## Assumptions

- The seven pages and the sidebar order of 2026-11-17 stay.
- A sidebar entry gets a tone dot when its page has an attention row, as Status has today.
- The detail pages (one issue, one job, one session, one hook) are out of scope.

## Open choices for Chris

1. Sidebar groups: keep Factory and Claude (recommended), or group by job: Work (Issues, Jobs, Sessions) and System
   (Automation, Agents, Memory, Hooks).
2. Analysis views: open with a figure band (recommended), or with one sentence as Status does.
3. The cuts in the Pages table.

## Next steps

1. Draw from `data.public.json`. A new run of `snapshot.ts` writes `data.json` with the private texts in it: replace
   the texts that the Data section lists before a commit.
2. Write `build.ts` and `mock.css`, with `app.css` as a real copy of `ui/app.css`, because the shelf does not serve
   symlinks.
3. Draw one page per sidebar page plus an overview, verify them in a browser, and put them on the shelf.
