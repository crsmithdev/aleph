---
name: refit-design
description: >
  Refit a UI to its design reference: compare a page or the whole UI to
  its design homes (`design/rules.md`, `design/components/`, the token comments of `ui/app.css`) in the code and in the drawn page: hard-coded or missing
  tokens, one-off components, pages that differ from the Design page, local defects.
  Use when asked to audit, review or check a UI against the design language,
  or to find where a page leaves the design doc. NOT for: writing the design
  doc (use design-language).
---

# Refit design

[refit-code](../refit-code/SKILL.md) for the look of a UI. `design/rules.md` and `design/components/` are the reference and the code is the
truth: where they differ, the finding says which one to change. This skill changes no text in `design/`: a gap
in the doc is a proposal. Follow [refit/PROCESS.md](../refit/PROCESS.md) for the modes, the steps and the Act loop.
This file holds what differs.

## Lenses

| Lens | Asks | File |
|---|---|---|
| **apply** | Does the page follow `design/`, in code and as drawn? | [APPLY.md](APPLY.md) |
| **variants** | Is each component drawn one way? | [VARIANTS.md](VARIANTS.md) |
| **states** | Does each component draw its empty, loading, error, hover, focus, disabled and phone-width state? | [STATES.md](STATES.md) |
| **stress** | Does the page hold with long text, many rows, a missing value and no data? | [STRESS.md](STRESS.md) |
| **seams** | Does a view override a design class or build design markup by hand? | [SEAMS.md](SEAMS.md) |
| **dead** | Does each CSS rule match an element, each token have a use, each Design specimen draw a live component? | [DEAD.md](DEAD.md) |
| **slop** | Is a part bigger than its job: a nested card, an extra border, shadow or icon, a long label? | [SLOP.md](SLOP.md) |

Report each candidate under one lens only. A value that breaks a rule is apply. Two builds of one component are
variants. A missing empty line is states. An empty line that breaks at 200 characters is stress. A view that
restyles a design class is seams. A class that no element uses is dead. A part that carries more than its job is slop.

## Modes

`scan [route]`, `fix [route]` and `fix <run dir>` of PROCESS.md. `route` is one page, such as `#/issues`. With
none, the run covers each route of the router. The report's unit is a component kind, by [REPORT.md](REPORT.md).

## Find

1. **Scope.** The route's view file and the shared files it imports, or every view for the whole UI. Done when you
   have a list of files and routes.
2. **Hunt.** First list the page's components from its view code and the screenshot: each kind and variant, with
   an id (`<kind>[/<variant>]`) and the specimen id of `spec(id, ...)` in `ui/views/design.js`. Then follow each lens
   file: the code view, then the drawn view. For the whole UI, spawn one Explore subagent per route in one
   message, in place of one per lens, each with the Signals sections of the lens files and the component list
   verbatim. Each returns the candidates as: rule id of `design/rules.md` or a component file, `file:line` or screenshot, the kind. It also
   returns, per component, the rules it breaks and the rules it follows (each by rule id and
   text, from `design rules --for <component>`) and the Design specimen id. Done when each route has returned and each component has an entry.

## Notes

Each finding also becomes a note on the page it audited, so the user answers it in the dock as they answer their own.
Each finding in `findings.json` carries five more fields:

- `rule`: the rule id of `design/` that the finding breaks.
- `url`: the page as the dock stores it, `http://aleph.home/` and the route, such as `http://aleph.home/#/issues`.
- `selector`: a CSS selector that finds only the element the finding names: `document.querySelectorAll(selector)`
  gives 1 on the drawn page. On `#/design`, start it with the specimen's section, `#design-<id>`. Else `body`.
- `headline`: what is wrong, in plain words, at most 8 words: "Two motion tokens are never used".
- `plain`: why it matters and the change, in one or two short sentences with no path or line:
  "Nothing reads `--t-fast` or `--t-slow`. Delete both."

After you write the findings, run `bun skills/refit-design/scripts/notes.ts <run dir>`. It adds an agent note for
each `open` or `reverted` finding: the headline, the plain sentence, then `rule:`, `where:`, `from:` and the key line
`finding: <lens>:<rule>:<unit>`. The dock shows the first two and folds the rest. It skips a finding whose key an
unresolved note on that page holds. The HTML report stays as it is.

## Act order

Local defect, one-off, mismatch, then missing token. A proposal to amend the doc is not fixed: report it. Two
additions to the Act loop:

1. Before the first fix, take a `verify-ui` screenshot of the page.
2. After each fix, take the `verify-ui` screenshots again in light and dark at both widths. The baseline is
   green only when the page also matches the Design page. The commit names the rule and the finding.


## Guards

Each lens file's Guard section names its guard and its kind (tool, rule or unchecked).

## Red flags

- **You judged from the code alone.** A rule can hold in the CSS and fail on the page: draw it.
- **You fixed a pattern the doc does not cover.** That is a proposal to amend the doc. The Act loop leaves it.
- **You changed the doc to fit the page.** The doc changes only through design-language, with a proposal.
- **You compared the page to your taste.** A finding names a rule id of `design/`, or it is dropped.
