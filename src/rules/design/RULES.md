# Design Rules

Canonical rule set for the design domain. Read by:

- `src/skills/design-review/SKILL.md` — qualitative + checkable review of UI surfaces (covers all 18 sections, including typography at B via `typography.md` and accessibility/forms/perf at L-R via `accessibility.md`) with single combined scan → present → approve → fix → gate flow
- CLAUDE.md (project-local + global) — applied silently at write-time

Every checkable rule below can be evaluated against a real file and produce a plain-markdown finding citing this file's section anchor. Qualitative rules (hierarchy, motion, rhythm) require visual reasoning and are run by `design-review` against rendered surfaces.

Scope: UI source under `src/ui/` (React/TSX, CSS, Tailwind classes). Markdown previews in `src/rules/design/aleph/` count as reference, not source.

---

## A. Visual hierarchy & rhythm

*Qualitative — design-review walks rendered surfaces.* Source: `src/skills/design-review/design-principles.md`.

- **A.1** Primary action on every screen is unmissable within 2 seconds.
- **A.2** Vertical rhythm consistent; no "off by 1-2px" alignment.
- **A.3** Visual weight proportional to functional importance.

These rules require seeing the rendered page; `design-audit` checks them, not greppable.

---

## B. Typography

*See `typography.md` for the complete rule set.* Lifted verbatim from Matthew Butterick's *Practical Typography*.

Checkable highlights `design-review` is greppable on:

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

*Qualitative + checkable.* Source: `src/rules/design/aleph/` design system tokens.

- **C.1** No inline hex colors — use token references (`text-text-muted`, `bg-bg-secondary`, etc.). *Detect:* `#[0-9a-f]{3,6}` in TSX/CSS files. *Severity:* `important`. *Tag:* `tokens`.
- **C.2** Contrast ratio meets WCAG AA on every text/background pair. *Qualitative* — design-review checks rendered.
- **C.3** Color used purposefully — never decorative. *Qualitative.*

---

## D. Alignment & grid

*Qualitative.* Visual rhythm and pixel-perfect alignment require rendered inspection. `design-review` walks the screens.

---

## E. Components

Source: `src/skills/design-review/SKILL.md` dim 6, `src/rules/design/aleph/` shared primitives.

- **E.1** Shared primitives over hand-rolled markup. `<PageHeader>` not inline `<h1 className="...">`; `<DataTable>` not raw `<table>`. *Detect:* hand-rolled markup where a primitive exists. *Severity:* `important`. *Tag:* `composition`.
- **E.2** Interactive elements are `<button>` or `<a>`, never `<div onClick>`. *Detect:* `<div ... onClick>` or `<span ... onClick>`. *Severity:* `blocking`. *Tag:* `a11y`. (Also in `accessibility.md`.)
- **E.3** Every component handles loading, empty, and error states uniformly. *Detect:* component renders data-derived content but has no fallback branch. *Severity:* `important`. *Tag:* `state-coverage`.

---

## F. Iconography

- **F.1** Single icon set across the app (Material Symbols per `src/rules/design/aleph/RULES.md`). *Detect:* import from a non-canonical icon library. *Severity:* `important`. *Tag:* `consistency`.
- **F.2** Decorative icons have `aria-hidden="true"`; icon-only buttons have `aria-label`. *See `accessibility.md` for full.*

---

## G. Motion

*Qualitative.* Animations purposeful only — no decorative motion. `design-review` checks rendered.

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

*Qualitative.* "Can this be removed without losing meaning?" — design-review applies the reduction filter.

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

## S. React / Hook anti-patterns

*Sources: blopa/musclog deslop, expo deep-code-review, React docs (rules-of-hooks).*

### S.1 No div soup

Don't wrap content in `<div>` when a Fragment (`<>...</>`) or a semantic element (`<section>`, `<nav>`, `<header>`, `<main>`, `<article>`, `<button>`) is correct. Wrapper divs added solely to satisfy a single-child constraint or to attach a className that doesn't need a DOM node are slop.

- **Detect:** `<div>` with no className, style, role, or event handler, wrapping a single child or returning sibling JSX
- **Severity:** `nit`
- **Tag:** `slop`, `react`

### S.2 No derived-state `useEffect`

A `useEffect` that syncs one state variable from another is wrong — calculate the derived value during render. Same for `useEffect` that copies a prop into state.

- **Detect:** `useEffect` whose body is a single `setState(deriveFrom(otherState))` call; deps array contains only state/props the effect reads to set another state
- **Severity:** `important`
- **Tag:** `react`, `correctness`

### S.3 No over-memoization

`useCallback` / `useMemo` around primitive values, trivial expressions, or values not passed to a memoized child / effect dependency are pure overhead. Memoize only when (a) the value is passed to a memoized child (`React.memo`), (b) the value is a dependency of `useEffect` / `useMemo` / `useCallback`, or (c) the computation is genuinely expensive.

- **Detect:** `useCallback(() => x + 1, [x])`, `useMemo(() => primitive, [...])`, memoized values never destructured into a memoized child
- **Severity:** `nit`
- **Tag:** `react`, `slop`

### S.4 No improper `useRef`

Refs mutated during render are unsafe. Refs used where controlled state belongs (e.g., reading user input to display it back) are wrong. `useRef` is for: imperative DOM access, mutable values that don't trigger re-render, and values whose changes shouldn't be visible until a side effect runs.

- **Detect:** `ref.current = ...` assignment outside `useEffect` / event handlers / `useLayoutEffect`; ref read in JSX expecting reactivity
- **Severity:** `important`
- **Tag:** `react`, `correctness`

### S.5 No stale closures in effects / timers

`useEffect(fn, [])` referencing state inside a `setInterval` / `setTimeout` / `addEventListener` callback captures the initial render's state forever. Use a ref, or include the state in the deps array, or use the functional form of `setState`.

- **Detect:** `useEffect` with empty deps array containing a setTimeout/setInterval/addEventListener whose callback references state or props
- **Severity:** `important`
- **Tag:** `react`, `correctness`

### S.6 No inline reference churn in hot paths

Inline objects (`<Context.Provider value={{ a, b }}>`) or inline functions (`<FlatList renderItem={item => ...} />`) create a fresh reference every render, defeating downstream memoization. Hoist to `useMemo` / `useCallback` for Context Providers and high-volume list renderers.

- **Detect:** JSX literal object or arrow function passed as a prop to `Provider`, `FlatList.renderItem`, `FlatList.keyExtractor`, or a `React.memo`-wrapped component
- **Severity:** `important`
- **Tag:** `react`, `performance`

### S.7 Effects with subscriptions / fetches need cleanup

`useEffect` that calls `addEventListener`, sets up an interval/timeout, opens a connection, or starts a fetch needs the matching cleanup in its return function. Fetches need `AbortController`; listeners need `removeEventListener`; intervals need `clearInterval`.

- **Detect:** `useEffect` body adds a listener / starts an interval / starts an unbounded fetch with no return function
- **Severity:** `blocking`
- **Tag:** `react`, `leak`

---

## Reference files

- `accessibility.md` — ~50 rules covering a11y, focus, forms, content handling, images, performance, navigation, touch, safe areas, dark mode, locale, hydration, hover states, content & copy, anti-patterns
- `typography.md` — ~50 rules covering characters, spacing, formatting, layout, responsive, dark mode, maxims
- `src/skills/design-review/design-principles.md` — qualitative design principles (simplicity, hierarchy, consistency, alignment, whitespace, responsive, feeling)
- `src/skills/design-review/audit-template.md` — phased output format for qualitative reviews
- `src/rules/design/aleph/` — Aleph's design tokens, kits, previews (visual specs)

---

## Negative-filter list (uniform with other review leaves)

`design-review` MUST NOT emit findings for:

- Style preferences not enumerated above or in reference files
- Subjective aesthetic alternatives presented as bugs
- Pre-existing issues outside the audit scope
- Pedantic nitpicks
- Issues a linter (stylelint, eslint-plugin-jsx-a11y) would catch — cite the linter rule instead
- Lint-ignored lines

---

## Citation format for findings

Findings cite rules as `design/RULES.md#<section-id>` — e.g., `design/RULES.md#L.1`, `design/RULES.md#B.4`. Section IDs follow the same convention as `code/RULES.md`.

When the deep rule lives in `accessibility.md` or `typography.md`, the umbrella section here is the citation; the reference file is supporting detail.
