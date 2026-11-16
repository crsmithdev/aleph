---
name: refit-design
description: >
  Refit a UI to its design reference: compare a page or the whole UI to
  docs/design.md in the code and in the drawn page, and find hard-coded or
  missing tokens, one-off components, pages that differ from the Kit, and
  local defects. Use when asked to audit, review or check a UI against the
  design language, or to find where a page leaves the design doc. NOT for:
  writing the design doc (use design-language).
---

# Refit design

[refit-code](../refit-code/SKILL.md) for the look of a UI. `docs/design.md` is the reference and the code is the
truth: where they differ, the finding says which one to change. Read `PRINCIPLES.md` and `.refit.json` first, as
refit-code does. This skill changes no `docs/design.md` text: a gap in the doc is a proposal.

## Lenses

| Lens | Asks | File |
|---|---|---|
| **apply** | Does this page follow the rules of `docs/design.md`, in its code and as drawn? | [APPLY.md](APPLY.md) |
| **variants** | Is each component drawn one way? | [VARIANTS.md](VARIANTS.md) |
| **states** | Does each component draw its empty, loading, error, hover, focus, disabled and phone-width state? | [STATES.md](STATES.md) |
| **stress** | Does the page hold with long text, many rows, a missing value and no data? | [STRESS.md](STRESS.md) |
| **seams** | Does a view override a kit class, or build kit markup by hand, instead of calling the kit helper? | [SEAMS.md](SEAMS.md) |
| **dead** | Does each CSS rule match an element, each token have a use, and each Kit specimen draw a live component? | [DEAD.md](DEAD.md) |
| **slop** | Is a piece of the page bigger than its job: a nested card, an extra border, shadow or icon, a label longer than the terse rule? | [SLOP.md](SLOP.md) |

Report each candidate under one lens only. A value that breaks a rule is apply. Two builds of one component are
variants. A missing empty line is states. An empty line that breaks at 200 characters is stress. A view that
restyles a kit class is seams. A class that no element uses is dead.

## Modes

| Mode | Runs | Reach for it |
|---|---|---|
| `retro [route]` (default: the whole UI) | Baseline, inventory, shots, compare, prove, report | Find where the UI leaves the doc |
| `act` | The fix of each finding the user picks | After a retro |
| `check` | Each new view, style rule or component in a plan, spec or diff | Before or during a build |

`route` is one page, such as `#/issues`. With none, the run covers each route of the UI's router.

## Retro

1. **Baseline.** Run the repo's build and test commands; a red baseline ends the run. Record the commit and
   `git status --porcelain`. Done when the baseline is green and recorded.
2. **Scope.** The route's view file and the shared files it imports, or every view for the whole UI. Done when you
   have a list of files and routes.
3. **Hunt.** First list the page's components from its view code and the screenshot: each kind and variant, with an
   id (`<kind>[/<variant>]`) and the specimen id of `spec(id, ...)` in `ui/views/kit.js`. Then follow each lens
   file of the table: the code view, then the drawn view. For the whole UI, spawn one Explore subagent per route in one
   message, each with the Signals sections of the lens files and the component list verbatim. Each returns the
   candidates as: rule of `docs/design.md`, `file:line` or screenshot, the kind. It also returns, per component, the
   rules it breaks and the rules it follows (each by `docs/design.md` section and rule text) and the Kit specimen id.
   Done when each route has returned and each component has an entry.
4. **Prove, hold and report.** Follow refit-code's [PROVE.md](../refit-code/PROVE.md) with the lens files, but write
   the report of this skill's [REPORT.md](REPORT.md) to `<tmpdir>/refit-design-retro-<timestamp>/index.html` in
   place of refit-code's. Done when PROVE.md's step 3 is done.

## Act

refit-code's [Act](../refit-code/SKILL.md#act) with these changes:

1. **Baseline.** Run the baseline of Retro step 1 and take a `verify-ui` screenshot of the page before any change.
2. **One commit per finding.** Order: local defect, one-off, mismatch, then missing token. Edit only the lines the
   finding names. A proposal to amend the doc is not fixed: report it.
3. **Prove each finding.** Run the baseline commands, then take the `verify-ui` screenshots again in light and
   dark at both widths. Green and the page matches the Kit: commit, naming the rule and the finding. Red: revert
   that finding and record which proof step missed.

## Check

1. **List the new things.** From the plan, spec or diff: each new view, style rule, colour, size, font, format,
   component and piece of UI text.
2. **Ask** the Check question of each lens file of each item. Record the `docs/design.md` rule or the Kit specimen that backs it.
3. **Judge.** Each item gets one verdict: **keep**, **reuse** (name the token, helper or component), **fix** (name
   the rule), or **amend** (the doc does not cover it: report a proposal). Done when every item has a verdict.

## Holds

| Lens | Hold | Kind |
|---|---|---|
| apply | A literal colour, size or font that has a token | tool: the `guard:` test in `skills/refit-design/refit-design.test.ts` fails when the `inventory.ts` rows of kind `literal` rise |
| apply | A value formatted by hand that has a helper | unchecked: `inventory.ts` rows of kind `helper-bypass`, not yet wired as a test |
| apply | A new component with no section in `docs/design.md` and no specimen on `#/kit` | model: `check` |
| variants | A component drawn a second way from its specimen on `#/kit` | model: `check` |
| states | A new component with no empty, loading and error state named | model: `check` |
| states | The Kit draws the empty and loading states | tool: the Kit test in `ui/browser.test.ts` |
| stress | A new list, table or text field with no limit for long text and many rows | model: `check` |
| seams | A view that styles a kit class or writes kit markup by hand | model: `check` |
| dead | A CSS rule that no element matches | unchecked: no script lists unmatched rules yet |
| slop | A note, label or caption of more than two words | model: `check` |

## Red flags

- **You judged from the code alone.** A rule can hold in the CSS and fail on the page: draw it.
- **You fixed a pattern the doc does not cover.** That is a proposal to amend the doc. `act` leaves it.
- **You changed the doc to fit the page.** The doc changes only through design-language, with a proposal.
- **You compared the page to your taste.** A finding names a rule of `docs/design.md`, or it is dropped.
