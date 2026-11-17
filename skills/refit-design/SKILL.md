---
name: refit-design
description: >
  Refit a UI to its design reference: compare a page or the whole UI to
  docs/design.md in the code and in the drawn page: hard-coded or missing
  tokens, one-off components, pages that differ from the Kit, local defects.
  Use when asked to audit, review or check a UI against the design language,
  or to find where a page leaves the design doc. NOT for: writing the design
  doc (use design-language).
---

# Refit design

[refit-code](../refit-code/SKILL.md) for the look of a UI. `docs/design.md` is the reference and the code is the
truth: where they differ, the finding says which one to change. Read `PRINCIPLES.md` and `.refit.json` first. This
skill changes no `docs/design.md` text: a gap in the doc is a proposal.

## Lenses

| Lens | Asks | File |
|---|---|---|
| **apply** | Does the page follow `docs/design.md`, in code and as drawn? | [APPLY.md](APPLY.md) |
| **variants** | Is each component drawn one way? | [VARIANTS.md](VARIANTS.md) |
| **states** | Does each component draw its empty, loading, error, hover, focus, disabled and phone-width state? | [STATES.md](STATES.md) |
| **stress** | Does the page hold with long text, many rows, a missing value and no data? | [STRESS.md](STRESS.md) |
| **seams** | Does a view override a kit class or build kit markup by hand? | [SEAMS.md](SEAMS.md) |
| **dead** | Does each CSS rule match an element, each token have a use, each Kit specimen draw a live component? | [DEAD.md](DEAD.md) |
| **slop** | Is a part bigger than its job: a nested card, an extra border, shadow or icon, a long label? | [SLOP.md](SLOP.md) |

Report each candidate under one lens only. A value that breaks a rule is apply. Two builds of one component are
variants. A missing empty line is states. An empty line that breaks at 200 characters is stress. A view that
restyles a kit class is seams. A class that no element uses is dead. A part that carries more than its job is slop.

## Modes

| Mode | Runs | Reach for it |
|---|---|---|
| `retro [route]` (default: the whole UI) | Baseline, inventory, shots, compare, prove, fix, report | Find where the UI leaves the doc and fix the auto findings |
| `scan [route]` | The retro without the fix | Find what to improve, change nothing |
| `act` | The fix of each ask finding Chris approves | After a retro |
| `check` | Each new view, style rule or component in a plan, spec or diff | Before or during a build |

`route` is one page, such as `#/issues`. With none, the run covers each route of the router.

## Retro

1. **Baseline.** Run the repo's build and test commands. A red baseline ends the run. Record the commit and
   `git status --porcelain`. Done when the baseline is green and recorded.
2. **Scope.** The route's view file and the shared files it imports, or every view for the whole UI. Done when you
   have a list of files and routes.
3. **Hunt.** First list the page's components from its view code and the screenshot: each kind and variant, with an
   id (`<kind>[/<variant>]`) and the specimen id of `spec(id, ...)` in `ui/views/kit.js`. Then follow each lens
   file: the code view, then the drawn view. For the whole UI, spawn one Explore subagent per route in one message,
   each with the Signals sections of the lens files and the component list verbatim. Each returns the
   candidates as: rule of `docs/design.md`, `file:line` or screenshot, the kind. It also returns, per component, the
   rules it breaks and the rules it follows (each by `docs/design.md` section and rule text) and the Kit specimen id.
   Done when each route has returned and each component has an entry.
4. **Prove, guard, fix and report.** Follow refit-code's [PROVE.md](../refit-code/PROVE.md) with the lens files.
   Write the report of [REPORT.md](REPORT.md), with a component kind as its unit. Done when PROVE.md's step 3 is
   done.

## Act

refit-code's [Act](../refit-code/SKILL.md#act) with these changes:

1. **Baseline.** Run Retro step 1 and take a `verify-ui` screenshot of the page before any change.
2. **One commit per finding.** Order: local defect, one-off, mismatch, then missing token. Edit only the lines the
   finding names. A proposal to amend the doc is not fixed: report it.
3. **Prove each finding.** Run the baseline commands, then take the `verify-ui` screenshots again in light and
   dark at both widths. Green and the page matches the Kit: commit, naming the rule and the finding. Red: revert
   that finding and record which proof step missed.

## Check

1. **List the new things.** From the plan, spec or diff: each new view, style rule, colour, size, font, format,
   component and piece of UI text.
2. **Ask** the Check question of each lens file about each item. Record the `docs/design.md` rule or the Kit specimen that backs it.
3. **Judge.** Each item gets one verdict: **keep**, **reuse** (name the token, helper or component), **fix** (name
   the rule), or **amend** (the doc does not cover it: report a proposal). Done when every item has a verdict.

## Guards

Each lens file's Guard section names its guard and its kind (tool, model or unchecked).

## Red flags

- **You judged from the code alone.** A rule can hold in the CSS and fail on the page: draw it.
- **You fixed a pattern the doc does not cover.** That is a proposal to amend the doc. `act` leaves it.
- **You changed the doc to fit the page.** The doc changes only through design-language, with a proposal.
- **You compared the page to your taste.** A finding names a rule of `docs/design.md`, or it is dropped.
