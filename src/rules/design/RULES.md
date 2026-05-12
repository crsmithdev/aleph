# Design Rules

Canonical rule set for the design domain. Read by:

- `src/skills/design-audit/SKILL.md` — qualitative + checkable audit of UI surfaces (covers all 18 sections, including typography at B via `typography.md` and accessibility/forms/perf at L-R via `accessibility.md`)
- `src/skills/design-fix/SKILL.md` — peer-drift fixes (the fix verb for the design domain)
- CLAUDE.md (project-local + global) — applied silently at write-time

Every checkable rule below can be evaluated against a real file and produce a SARIF finding (per `src/skills/_shared/finding.md`). Qualitative rules (hierarchy, motion, rhythm) require visual reasoning and are run by `design-audit` against rendered surfaces.

Scope: UI source under `src/ui/` (React/TSX, CSS, Tailwind classes). Markdown previews in `src/skills/design-construct/` count as reference, not source.

---

## A. Visual hierarchy & rhythm

*Qualitative — design-audit walks rendered surfaces.* Source: `src/skills/design-audit/design-principles.md`.

- **A.1** Primary action on every screen is unmissable within 2 seconds.
- **A.2** Vertical rhythm consistent; no "off by 1-2px" alignment.
- **A.3** Visual weight proportional to functional importance.

These rules require seeing the rendered page; `design-audit` checks them, not greppable.

---

## B. Typography

*See `typography.md` for the complete rule set.* Lifted verbatim from Matthew Butterick's *Practical Typography*.

Checkable highlights `design-audit` is greppable on:

- **B.1** Curly quotes only — straight `"`/`'` in JSX text is forbidden. *Detect:* grep for `"` or `'` between `>` and `<` in JSX. *Severity:* `nit`. *Tag:* `typography`.
- **B.2** Em/en dash discipline — `--` and `---` in rendered text are forbidden. *Detect:* same as B.1. *Severity:* `nit`. *Tag:* `typography`.
- **B.3** Three-period ellipsis is forbidden in rendered text — use `&hellip;` or `…`. *Severity:* `nit`. *Tag:* `typography`.
- **B.4** `max-width: 65ch` (or equivalent) on text containers. *Detect:* prose containers with no max-width. *Severity:* `important`. *Tag:* `readability`.
- **B.5** `line-height` between 1.2 and 1.45 on body text. *Severity:* `nit`. *Tag:* `readability`.
- **B.6** `font-feature-settings: "kern" 1` on body text. *Severity:* `nit`. *Tag:* `typography`.
- **B.7** All-caps text needs `letter-spacing: 0.06em` (or equivalent). *Detect:* `text-transform: uppercase` without `letter-spacing`. *Severity:* `nit`. *Tag:* `typography`.
- **B.8** `font-variant-numeric: tabular-nums` on data-table numeric columns. *Severity:* `nit`. *Tag:* `data-display`.

Full ruleset (~50 rules covering characters, spacing, formatting, layout, responsive, dark mode): see `typography.md`.

---

## C. Color

*Qualitative + checkable.* Source: `src/skills/design-construct/` design system tokens.

- **C.1** No inline hex colors — use token references (`text-text-muted`, `bg-bg-secondary`, etc.). *Detect:* `#[0-9a-f]{3,6}` in TSX/CSS files. *Severity:* `important`. *Tag:* `tokens`.
- **C.2** Contrast ratio meets WCAG AA on every text/background pair. *Qualitative* — design-audit checks rendered.
- **C.3** Color used purposefully — never decorative. *Qualitative.*

---

## D. Alignment & grid

*Qualitative.* Visual rhythm and pixel-perfect alignment require rendered inspection. `design-audit` walks the screens.

---

## E. Components

Source: `src/skills/design-audit/SKILL.md` dim 6, `src/skills/design-construct/` shared primitives.

- **E.1** Shared primitives over hand-rolled markup. `<PageHeader>` not inline `<h1 className="...">`; `<DataTable>` not raw `<table>`. *Detect:* hand-rolled markup where a primitive exists. *Severity:* `important`. *Tag:* `composition`.
- **E.2** Interactive elements are `<button>` or `<a>`, never `<div onClick>`. *Detect:* `<div ... onClick>` or `<span ... onClick>`. *Severity:* `blocking`. *Tag:* `a11y`. (Also in `accessibility.md`.)
- **E.3** Every component handles loading, empty, and error states uniformly. *Detect:* component renders data-derived content but has no fallback branch. *Severity:* `important`. *Tag:* `state-coverage`.

---

## F. Iconography

- **F.1** Single icon set across the app (Material Symbols per `design-construct/`). *Detect:* import from a non-canonical icon library. *Severity:* `important`. *Tag:* `consistency`.
- **F.2** Decorative icons have `aria-hidden="true"`; icon-only buttons have `aria-label`. *See `accessibility.md` for full.*

---

## G. Motion

*Qualitative.* Animations purposeful only — no decorative motion. `design-audit` checks rendered.

---

## H. State coverage (empty / loading / error)

- **H.1** Every screen with no data has an intentional empty state, not a blank render. *Detect:* component with `data?.length === 0` branch missing or rendering nothing. *Severity:* `important`. *Tag:* `state-coverage`.
- **H.2** Loading states use the project's shared skeleton/spinner primitive, not ad-hoc. *Detect:* hand-rolled loading indicator in a component that should use `<Skeleton>` or peers' pattern. *Severity:* `important`. *Tag:* `consistency`.
- **H.3** Error states styled consistently and actionable. *Detect:* `catch` rendering raw error string. *Severity:* `important`. *Tag:* `error-handling`.

---

## I. Dark mode

- **I.1** `color-scheme: dark` on `<html>` when dark theme is active. *Detect:* dark theme present in tokens but no `color-scheme` declaration. *Severity:* `important`. *Tag:* `theme`.
- **I.2** Dark mode is *designed*, not inverted — shadows, contrast, token mapping all hold up. *Qualitative.*

---

## J. Density

*Qualitative.* "Can this be removed without losing meaning?" — design-audit applies the reduction filter.

---

## K. Responsiveness & touch

See `accessibility.md` "Touch & Interaction" and "Safe Areas & Layout" sections. Highlights:

- **K.1** `touch-action: manipulation` on tappable elements. *Severity:* `important`. *Tag:* `mobile`.
- **K.2** `overscroll-behavior: contain` in modals/drawers/sheets. *Severity:* `important`. *Tag:* `mobile`.
- **K.3** Full-bleed layouts use `env(safe-area-inset-*)`. *Severity:* `important`. *Tag:* `mobile`.
- **K.4** Touch targets sized for thumbs (≥ 44×44 CSS px). *Severity:* `important`. *Tag:* `mobile`.

---

## L. Accessibility

*See `accessibility.md` for the complete ~50-rule checklist.* Highest-priority subset:

- **L.1** Icon-only buttons have `aria-label`. *Severity:* `blocking`. *Tag:* `a11y`.
- **L.2** Form controls have `<label>` or `aria-label`. *Severity:* `blocking`. *Tag:* `a11y`.
- **L.3** Interactive elements have visible focus state. *Detect:* `outline-none` or `outline: none` without `focus-visible:` replacement. *Severity:* `blocking`. *Tag:* `a11y`.
- **L.4** Semantic HTML before ARIA — `<button>` for actions, `<a>` for navigation. *Severity:* `blocking`. *Tag:* `a11y`.
- **L.5** Decorative icons have `aria-hidden="true"`. *Severity:* `important`. *Tag:* `a11y`.
- **L.6** Async updates (toasts, validation) have `aria-live`. *Severity:* `important`. *Tag:* `a11y`.

Full list: `accessibility.md`.

---

## M. Forms

*See `accessibility.md` "Forms" section.*

- **M.1** Inputs have `autocomplete` and meaningful `name`. *Severity:* `important`. *Tag:* `forms`.
- **M.2** Inputs use correct `type` (`email`, `tel`, `url`, `number`). *Severity:* `important`. *Tag:* `forms`.
- **M.3** Labels clickable (`htmlFor` or wrapping). *Severity:* `important`. *Tag:* `forms`.
- **M.4** Never block paste. *Detect:* `onPaste` with `preventDefault`. *Severity:* `blocking`. *Tag:* `forms`.
- **M.5** Errors inline next to fields; focus first error on submit. *Severity:* `important`. *Tag:* `forms`.

---

## N. Performance

*See `accessibility.md` "Performance" section.*

- **N.1** Large lists (>50 items) virtualized. *Detect:* `.map()` over array with no virtualization wrapper. *Severity:* `important`. *Tag:* `perf`.
- **N.2** Images have explicit `width` and `height`. *Severity:* `important`. *Tag:* `cls`.
- **N.3** Below-fold images `loading="lazy"`. *Severity:* `nit`. *Tag:* `perf`.
- **N.4** No layout reads in render (`getBoundingClientRect`, `offsetHeight`, etc.). *Severity:* `important`. *Tag:* `perf`.

---

## O. Navigation & state

*See `accessibility.md` "Navigation & State" section.*

- **O.1** URL reflects state (filters, tabs, pagination). *Severity:* `important`. *Tag:* `state-mgmt`.
- **O.2** Links use `<a>`/`<Link>` (Cmd+click, middle-click). *Severity:* `important`. *Tag:* `navigation`.
- **O.3** Destructive actions need confirmation or undo. *Severity:* `important`. *Tag:* `destructive-action`.

---

## P. Hydration safety

*See `accessibility.md` "Hydration Safety" section.*

- **P.1** Inputs with `value` need `onChange`. *Severity:* `blocking`. *Tag:* `hydration`.
- **P.2** Date/time rendering guarded against SSR mismatch. *Severity:* `important`. *Tag:* `hydration`.

---

## Q. Locale & i18n

*See `accessibility.md` "Locale & i18n" section.*

- **Q.1** Dates use `Intl.DateTimeFormat`, not hardcoded. *Severity:* `important`. *Tag:* `i18n`.
- **Q.2** Numbers use `Intl.NumberFormat`, not hardcoded. *Severity:* `important`. *Tag:* `i18n`.
- **Q.3** Brand names / code tokens / identifiers wrapped with `translate="no"`. *Severity:* `nit`. *Tag:* `i18n`.

---

## R. Anti-patterns

*See `accessibility.md` "Anti-patterns" section.* Top examples (every one is a `blocking` finding):

- `user-scalable=no` / `maximum-scale=1` (zoom disabled)
- `outline-none` without focus replacement
- `<div onClick>` for navigation
- Images without `width`/`height`
- Icon buttons without `aria-label`
- Form inputs without labels
- Hardcoded date/number formats

---

## Reference files

- `accessibility.md` — ~50 rules covering a11y, focus, forms, content handling, images, performance, navigation, touch, safe areas, dark mode, locale, hydration, hover states, content & copy, anti-patterns
- `typography.md` — ~50 rules covering characters, spacing, formatting, layout, responsive, dark mode, maxims
- `src/skills/design-audit/design-principles.md` — qualitative design principles (simplicity, hierarchy, consistency, alignment, whitespace, responsive, feeling)
- `src/skills/design-audit/audit-template.md` — phased output format for qualitative audits
- `src/skills/design-construct/` — Construct's design tokens, kits, previews (visual specs)

---

## Negative-filter list (uniform with `src/skills/_shared/finding.md`)

`design-audit` MUST NOT emit findings for:

- Style preferences not enumerated above or in reference files
- Subjective aesthetic alternatives presented as bugs
- Pre-existing issues outside the audit scope
- Pedantic nitpicks
- Issues a linter (stylelint, eslint-plugin-jsx-a11y) would catch — cite the linter rule instead
- Lint-ignored lines

---

## Citation format for findings

Findings cite rules as `design/RULES.md#<section-id>` — e.g., `design/RULES.md#L.1`, `design/RULES.md#B.4`. Section IDs follow the same convention as `code/RULES.md` (see `src/skills/_shared/finding.md` "ruleId conventions").

When the deep rule lives in `accessibility.md` or `typography.md`, the umbrella section here is the citation; the reference file is supporting detail.
