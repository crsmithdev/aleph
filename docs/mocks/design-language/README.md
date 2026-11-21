# Design-language mock

Request (Chris, 2026-11-21): build the mock of the confirmed design-language concept from the grill. Each project owns a
design language of tokens, components and patterns. An agent works as a librarian: it surveys the rendered UI and raises
each difference between the UI and the language.

`gen.ts` draws the pages with the real UI helpers of `ui/views/lib/html.js` and `ui/app.css` (a copy, not a link). Rerun
with `bun docs/mocks/design-language/gen.ts`: the output is the same each time. The dock is drawn by hand after
`~/aleph-tools/dock.js`, which is not in this repo. The bar at the top switches views. It is the mock's only frame.

## Views

1. **Queue.** `index.html#queue`. The Hooks page with the dock open on the Language panel. One fix made alone, then four
   differences: a split, a drift, a gap and an orphan.
2. **Split.** `index.html#split`. The split "Reveal hidden detail": three variants, counts, the recommendation, the answers.
3. **Proposal.** `proposal.html`. The Issue page with the dock open on one proposal for the gap. Pick a text size in
   "Live token" and the Add note field on the page changes.
4. **Exception.** `index.html#exception`. Record an exception: place, rule, your reason.
5. **First run.** `first-run.html`. The language drafted by layer, the groups to approve and the splits to answer.
6. **Guide.** `guide.html`. Every rule, and the measure strip. The Show control filters by class.

## Drawing decisions

Numbers in brackets are the settled decisions of the concept. "Default" is a line of its list "My defaults".

- **The dock holds the queue.** The surface is in place first, on any page, through the dock [13]. Only the first-run
  review and the guide are pages.
- **Four kinds, one badge each.** Drift, split, gap and orphan are the kinds of difference [6]. The badge tone comes from
  `tone()`, so a reader learns it once (design Principle 3).
- **Three answers on every item.** Change UI, Change language, Record exception [concept]. The agent's recommendation
  has a dashed edge. It does not press the answer.
- **The queue sorts by places touched.** The count sits at the right of each item. A dismissed item keeps its id, the
  `d-` code (default).
- **Evidence is a crop or a count.** An item shows the real part drawn by its helper, or a count. It never shows a
  claim alone (default).
- **A fix made alone shows its commit and a before and after.** Exact drift is fixed without a question, one commit per
  fix [7]. The panel can revert it. Tests pass is a line of the item (default).
- **The agent never changes the language.** Only a proposal changes it, and a person approves it [7]. Only you grant an
  exception [7]. The exception form has no reason written by the agent.
- **A split shows its variants side by side.** Crops, a bar of the count, and the files (default).
- **A proposal is one card.** Name, use, reason, class, test and home are the parts of a rule [8, 9]. Each part has an
  Edit button, so you approve the whole or edit parts (default). The commit line says one approval is one commit (default).
- **The home follows the strong order.** Token or shared component, then check, then prose [8]. The proposal names a
  component and a token because the gap has both.
- **A rule has a test.** The test is a machine check or a rendered do and don't pair [9]. Advice shows "none" and raises
  nothing. Class is a field.
- **The specimen is a do and don't pair.** The pair is the rendered test of the rule [9].
- **A conflict shows with its two answers.** A proposal that contradicts a rule shows the conflict (default).
- **An exception names its place and rule.** The form warns that many exceptions on one rule become a finding against
  the rule (default). The guide marks such a rule "finding".
- **First run is by layer.** Tokens, Components, Patterns [4, 11]. A group with an open split cannot be approved until you
  answer it. Each draft rule carries "adopted as found" [11]. `docs/design.md` is the first draft and the page says so [11].
- **The guide is one table per layer.** Each rule shows class, test, home, reason, marks and exception count.
- **The measure strip.** Design notes per agent-built page is the first tile. Survey and coverage are the checks [14].
  Your minutes per week is the cost (default).
- **UI text is terse.** Notes have one or two words, and the empty state is plain (design Principles 5 and 6).
- **Colour, type and space are tokens of `ui/app.css`.** The mock sets no raw colour or size, except a panel width.

## Data

Real:

- Tokens and their counts: `ui/app.css` `:root`.
- Groups, parts and rule counts: `docs/design.md`. The drafted-rule count is bullets plus table rows of a section.
- The first-draft sources and principles: `docs/design.md`.
- Places and files of each difference, measured in `ui/views` on 2026-11-21: `fold()` 27 calls, `button.fold` 2
  (`issues.js:187`, `factory-agents.js:80`), `clamp()` 3 (`session.js:37`, `gates.js:190`, `lib/timeline.js:135`);
  hand textarea 3 and checkbox 2; `moreFold()` has no caller outside the Design page and a test.
- The drift "A data cell never holds a button" and its 5 places, and the fixed drift "Every integer through count()":
  finding f13 and f12 of `refit-design-20261120-085656` (`findings.json`). Time column names: the Deviations table and a
  count of `"Time"` headers (3) against named ones (16).
- The Exceptions count of "Helpers build the parts" is the number of rows of the Deviations table. It stands in for
  recorded exceptions, which do not exist yet.
- Helpers, hook names and kind names come from `ui/views/lib/html.js`, `ui/views/hooks.js` and `hooks/`.

Invented:

- The fix commit `c4e91b2`, the `d-` ids and the hold counts of the Hooks tables.
- The measure strip: notes per page, pages per week, the 18 minutes, the 60% of parts tested.
- The exception counts of every rule except the one above, and the threshold of 3 that raises a finding.
- The recommendation of the agent, and the Issue page's notes.
- The Language fab and its nav item.

Not drawn: Deferred items. The mock cannot show a real survey, so the queue is fixed.

## Open risks the mock cannot answer

1. **Rendering.** The mock draws one fixed page. It does not show whether every page and state renders headless with data.
2. **Survey precision.** "Similar control" and "one job done two ways" have no threshold. The queue shows four clean
   items. A real queue may be noisy.
3. **Judged tests.** The do and don't pair is a picture. It does not show that two judge runs agree.
4. **Cost.** The 18 minutes are invented. Tokens and minutes per survey have no estimate.
5. **The headline count.** Notes through the dock are countable. Corrections in chat may not be.
6. **Writer reach.** The mock does not show how a writer gets the slice of the language it needs.
7. **Pilot fit.** The mock uses aleph's guide as the first draft and adds a Language page. What the Design page and the
   design skills become is a spec decision.
