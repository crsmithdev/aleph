---
name: design-language
description: >
  Design language: extract a UI's design language from its code into one
  reference doc, or audit the UI against that doc. Use when asked to find
  hard-coded colours, sizes or fonts, standardize tables, charts or value
  formats, or check a UI change against the design reference.
---

# Design language

The design language is what the code **already mostly does**, written down: tokens, formats, layout rules and components, each with its use count. The doc records the language; it does not invent a new one. A value that bypasses the language is a **deviation**, and each deviation becomes a fix.

The reference doc is `docs/design.md`. If it does not exist, run **Extract**. If it exists, run **Audit**. Change no UI code in either mode: the output is the doc and the issues.

## Inventory

Both modes start here. Find the UI's files: stylesheets, the page shell, the views or components, and the shared helpers. Then run:

```
bun <this skill>/scripts/inventory.ts <ui files or dirs> --summary
bun <this skill>/scripts/inventory.ts <ui files or dirs> > <scratchpad>/inventory.tsv
```

Each row is `file:line, group, property, value, kind`. Groups: colour, size, type, effect, format. Kinds: `token-def`, `token-use`, `literal`, `helper-bypass` (a value formatted by hand, with `toFixed`, `toLocale*`, `Intl`, date getters or `padStart`). The script reads text; a row inside a shared helper's own body is the helper, not a bypass. Every count in the doc comes from this script's output.

The script covers values. Read the code for the rest, and record it in the same `file:line` form:

- **Tables:** for each table, its columns in order, each column's header, kind of value, format, alignment, width rule, sort, truncation or wrap, and empty cell; the row height, row actions and where they sit, expansion, empty state, pager and filters.
- **Charts and data displays:** for each chart, sparkline, bar, metric card, badge, chip, meter or timeline, its type, data, colours, axes, units, legend, tooltip format, and empty and loading states.
- **Interaction:** hover, focus, active and disabled states of each button, link and clickable row; each disclosure (`<details>`, expanders) and what is open by default.
- **Content:** markdown, code blocks, diffs and command boxes: font, wrap or scroll, copy control.
- **Copy:** the case and wording of headers, buttons, state names, tooltips, and the empty, loading and error lines.
- **Layout:** each page's skeleton (header, breadcrumbs, sections, width) and what each table and chart does at a phone width.
- **Accessibility:** the contrast of each text and background token pair in light and dark, a visible focus ring, and states shown by colour alone.

Done when every group above has a list, and you can name the file you have not read, if any.

## Extract

1. **Read the decisions.** Search the repo's docs, specs and the memory vault for earlier UI decisions (mocks, column orders, time formats, shared parts). A decision outranks the code: where they differ, the code is the deviation. Done when each decision is listed with its source.
2. **Cluster.** Group each literal with the token or scale step it nearly matches: a colour within ΔE 3 of a token, a size within 2 px of a step, a font stack that differs only in fallbacks. Group formats by kind of value, and columns by kind of value. Done when each literal, format and column has a token, step, rule, or "no match".
3. **Derive the rules.** For each group, take the value with the most uses as the rule. Add a new token or rule only where 3 or more uses share none. Write rules for:
   - colour roles in light and dark; type families, sizes, weights and line heights; spacing steps; radii; shadows; breakpoints
   - one format per kind of value (absolute time, relative time, duration, cost, percent, count, ids), each named by its helper, and the rule for a missing value
   - table layout: column order, the column that takes spare width, alignment (numbers right in tabular figures, text left), links, badges, labels, actions, sort, truncation, row height, pager, empty state
   - charts: types and what each is for, series colours and order, axes, units, legends, tooltips, a time axis in the table time format, empty and loading states
   - interaction states, disclosure, content blocks, copy, page structure, responsive behaviour, accessibility minimums (text contrast 4.5:1), motion and reduced motion
   Done when every rule names its token or helper and its use count.
4. **Pick the references.** For each component (card, table, badge, chip, button, chart, filter bar, pager, page header, empty state), name the view that follows the rules best. Where two views build the same thing two ways, record it as a deviation. Confirm uncertain cases in a browser in light and dark at desktop and phone width, on a server you start on a free port and stop after. Done when each component has a reference view or a stated gap.
5. **Write `docs/design.md`:** tables and short lists, with these sections in order: Principles (at most 5, each drawn from the code with its reason, then Rules: what to use, and Do and Don't pairs of code); Foundations (Colour with contrast, Type, Space and shape: token tables of token, value or light and dark, role); Content (Values: kind, example, helper, missing; then Words as Do and Don't pairs); Components (an index with reference views, then one subsection per component: one sentence on what it is, when to use it, an anatomy table of numbered parts where it has more than three, its rules, and Do and Don't pairs); States; Layout (the shell and the page skeleton); Accessibility; Deviations; and an Appendix (what could not be determined, the bypasses that stay, the inventory counts). Show a rule by an example, not by a list of its CSS values. Each rule appears once, under the component or foundation it governs. Leave out which pages use a component and each page's own charts, tables and layout: they are not the language. Add one line to the UI's main doc that points to it. Cite code in the doc as `` `name` in `path` `` or a bare `` `path` ``, never `path:line`: a line moves with each edit above it, and the doc-claims test then fails CI.
6. **File the fixes.** One issue per group of deviations, worst first, through the repo's issue tool.

## Audit

1. Read `docs/design.md`.
2. Run the inventory on the whole UI, or on the files a change touched.
3. Mark each `literal`, `helper-bypass`, column and component against the doc: **follows**, **deviates** (name the rule), or **new** (a value or pattern the doc does not cover).
4. Report the deviations with `file:line`, the value, and the rule. A **new** pattern used 3 or more times is a proposal to amend the doc; list it apart from the deviations.

Done when every row of the inventory is marked, and the report gives the counts per mark.

## Done when

- Every literal, local format, table column and component in the UI appears in the doc as a token, format, rule, reference, or deviation. Check it by rerunning the inventory against the doc's lists, and report both counts.
- Every number in the doc comes from a run after your last edit.
- The doc says what you could not determine, such as a colour seen only in dark mode or a chart with no real data to render.
