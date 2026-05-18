---
name: design-review
description: Review UI design quality under src/ui/ against `src/rules/design/RULES.md` (18 dimensions — hierarchy, typography, color, alignment, components, iconography, motion, state coverage, dark mode, density, responsiveness, accessibility, forms, performance, navigation, hydration, locale, anti-patterns) plus Construct-specific rules in `src/rules/design/construct/RULES.md`. Scans, presents findings, applies approved fixes, runs `bun run ui:smoke`. Also self-invoked in enforce mode while writing UI source — applies token/surface/type/icon rules silently with no findings. Triggers on /design-review, /audit design, "audit the ui", "review the ui", "polish the interface", "make this feel professional", "make the pages match", "align the layouts", "design system", "construct design", "design tokens", "color tokens", "surface tokens", "type scale", "design reference", "design kit", "material symbols", "construct ui pattern", and is self-invoked whenever the agent is writing or editing UI source under src/ui/.
agent_backed:
  audit: design-reviewer
---

# design-review

Scans React/CSS/Tailwind under `src/ui/` against the design rule set, presents findings grouped by severity, asks at the approval gate, applies approved fixes, runs `bun run ui:smoke`.

Audit dispatches to the **`design-reviewer` agent** because qualitative rules (hierarchy, motion, alignment rhythm) need browser rendering via `bun run ui:smoke`. The agent reads this SKILL.md and executes the same process below.

<!-- BEGIN: orchestration -->

## Process

1. **Scope.** `git diff --name-only $(git merge-base HEAD main)..HEAD`. If empty on clean main, fall back to `--since HEAD~10`; if still empty, scope defaults to the entire codebase — every file matching the Domain table below. Pass `--module <path>` to narrow.
2. **Scan** the rules in Domain below. For each hit: file:line, rule cite, one-line message, fix, severity (blocking / important / nit / suggestion / praise).
3. **Re-read** each cited location. Drop false positives.
4. **Report** grouped by severity. One line per finding: `path:line — rule — message. Fix: ...`.
5. **STOP. Ask.** Security findings (secrets, auth, injection, crypto, RCE, IDOR, SSRF, XSS) → one at a time, no bulk path. Otherwise: apply all / pick / discard.
6. **Apply** approved fixes.
7. **Gate.** Run the command in Domain. On failure: report as a new blocking finding, stop.
8. **Closing:** `Applied N. Touched M files. Gate green. Skipped: <list>.`

## Guardrails

- Leaves never call `Skill()`.
- Nothing edits before step 5.
- No green closing without a green gate.

<!-- END: orchestration -->

## Domain

- Rules: `src/rules/design/RULES.md` (A–R), `src/rules/design/typography.md`, `src/rules/design/accessibility.md`, `src/rules/design/construct/RULES.md`
- Gate: `bun run --cwd src/ui ui:smoke` (loads every route in headless Chromium; passes only when each route renders without 5xx or console errors)
- Scope filter: only `*.tsx`, `*.css` under `src/ui/`
- Qualitative dimensions (hierarchy, motion, alignment, density) require a rendered view — the audit agent uses `bun run ui:smoke` and anchors every finding to a JSX `file:line`.
- `bun run build` alone is not sufficient; build pass ≠ feature works.
- Fix shapes: peer-drift propagation from a reference component to siblings (layout, component composition, state coverage, tokens), shared-primitive substitution (replace hand-rolled `<h1 class="...">` with `<PageHeader>`), token substitution (replace inline hex with token vars).

## Enforce mode (self-invoked while writing UI source)

When writing or editing files under `src/ui/`, apply `src/rules/design/construct/RULES.md` silently — no audit pass, no findings, no diff. Before producing UI source, read:

- `src/rules/design/construct/RULES.md` — Always / Never rule list
- `src/rules/design/construct/tokens/colors_and_type.css` — the token surface
- `src/rules/design/construct/kits/<closest-match>.html` — start from a kit; never redesign chrome
- `src/rules/design/construct/previews/components.html` and `previews/page_chrome.html` — visual specs

Core constraints: no inline hex (use tokens), three-tier surface system (`--bg-primary` / `--bg-secondary` / `--bg-tertiary`), Merriweather (`--font-heading`) only for stat numerics and the wordmark, tabular numerics in tables, body 14px / min 12px, radii 2/4/8/12, no drop shadows, no gradient backgrounds outside the Investigate hero, no emoji (use Material Symbols), magenta only on habits.
