# HANDOFF — Aleph Design System

You are integrating an exploratory design system from this project into the
real codebase at `construct/`. The repo's existing tokens, theme system, and
fonts are the **source of truth**; this project's files are a visual reference
plus a few additive bits (mainly: an offline Material Symbols font).

Read this whole doc before touching files.

---

## What this project is

`previews/*.html` and `kits/*.html` are static reference mockups of the
Aleph UI. They use:

- `tokens/colors_and_type.css` — fonts, type scale, spacing, radii (extra
  utility primitives the previews use).
- `tokens/themes.css` — generated from `construct/src/ui/web/src/themes.ts`;
  defines all 34 themes as `[data-theme-id="<id>"]` blocks. **Do not** ship
  this file to the repo — the repo already drives themes from `themes.ts` via
  `theme.tsx`. It exists here only so static HTML pages can swap themes.
- `tokens/theme-picker.js` — a vanilla-JS dropdown for static pages. **Do not**
  ship — the repo has `SettingsPage.tsx > ThemeSection`.
- `fonts/MaterialSymbolsOutlined.woff2` — the only material that needs to
  cross over (see below).

Everything else is a static reference. Treat the previews as a visual spec
when redesigning components, not as code to lift verbatim.

---

## What to actually change in the repo

### 1. Bundle Material Symbols offline (the one real change)

**Current state:** `construct/src/ui/web/index.html:10` loads Material Symbols
from `fonts.googleapis.com`. That's an external dependency and breaks offline.

**Action:**

1. Copy `fonts/MaterialSymbolsOutlined.woff2` from this project into
   `construct/src/ui/web/public/fonts/MaterialSymbolsOutlined.woff2`.
   (If `public/fonts/` doesn't exist, create it. Vite serves `public/` at root.)

2. In `construct/src/ui/web/index.html`, **delete** this line:
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
   ```

3. In `construct/src/ui/web/src/index.css`, add this block at the top, after
   the `@import "tailwindcss"` line:
   ```css
   @font-face {
     font-family: 'Material Symbols Outlined';
     src: url('/fonts/MaterialSymbolsOutlined.woff2') format('woff2');
     font-weight: 100 700;
     font-style: normal;
     font-display: block;
   }
   .material-symbols-outlined {
     font-family: 'Material Symbols Outlined';
     font-weight: normal;
     font-style: normal;
     line-height: 1;
     letter-spacing: normal;
     text-transform: none;
     display: inline-block;
     white-space: nowrap;
     word-wrap: normal;
     direction: ltr;
     -webkit-font-feature-settings: 'liga';
     -webkit-font-smoothing: antialiased;
     font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
     user-select: none;
     flex-shrink: 0;
   }
   ```
   (The `wght` of 300 matches the lighter stroke weight the previews use.
   If existing repo screens look heavier and that's intended, drop this block
   and keep only `@font-face`.)

4. Verify: `pnpm dev` → open any page with icons → confirm glyphs render.
   Then disconnect from network and reload — glyphs should still render.

### 2. (Optional) Bundle brand fonts offline too

Same pattern, lower priority. Currently `index.html:9` loads
Merriweather / Noto Sans / Noto Sans Mono from Google Fonts.

The repo already has the TTFs at `fonts/*.ttf` — but they're not currently
referenced from CSS. To go fully offline:

1. Move `fonts/Merriweather-VariableFont_opsz_wdth_wght.ttf`,
   `NotoSansDisplay-VariableFont_wdth_wght.ttf`,
   `NotoSansMono-VariableFont_wdth_wght.ttf` into `src/ui/web/public/fonts/`.
2. Replace the Google Fonts `<link>` in `index.html` with `@font-face` rules
   in `index.css` (see this project's `tokens/colors_and_type.css` for the
   exact `@font-face` declarations — variable-font ranges included).
3. Decide between `font-display: swap` (current Google behaviour) or `block`.

Skip this step if offline is not a goal.

---

## What NOT to change

- **`construct/src/ui/web/src/themes.ts`** — already canonical. Don't replace
  with `tokens/themes.css` from this project; that file was generated *from*
  `themes.ts`.
- **`construct/src/ui/web/src/theme.tsx`** — the React provider already handles
  `data-theme-id` (well, `data-theme` mode + JS-applied vars). Don't replace
  with `tokens/theme-picker.js`.
- **`construct/src/ui/web/src/pages/system/SettingsPage.tsx > ThemeSection`** —
  already a working theme picker.
- The repo's existing `--c-accent`, `--c-accent-hover`, etc. derivation in
  `index.css:48-66` is correct and stays. The previews use the same names.

---

## Using the previews as a visual spec

When redesigning a component or page, open the matching reference and match
**spacing, weights, and pattern** — not necessarily exact pixel values.

| Repo file | Reference |
|---|---|
| `components/ui/Button.tsx`, `Badge.tsx`, `Select.tsx`, `Modal.tsx`, `Spinner.tsx` | `previews/components.html` |
| `components/data/StatCard.tsx`, `MetricCard.tsx`, `DataTable.tsx` | `previews/components.html` (cards), `previews/data_viz.html` (tables + charts) |
| `components/charts/*` | `previews/data_viz.html` |
| `components/layout/Sidebar.tsx`, `PageHeader.tsx`, `Layout.tsx` | `previews/page_chrome.html` |
| `pages/life/SummaryPage.tsx` and other Life pages | `kits/life.html` |
| `pages/research/*` | `kits/research.html` |
| `pages/system/observability/*` | `kits/observability.html` |
| Type scale, color tokens, eyebrow/title patterns | `previews/foundations.html` |

Specific patterns the previews establish that the repo should follow:

- **Page titles** — Merriweather 700, 26px, tight tracking. Match `PageHeader`.
- **Section eyebrows** — 12px, weight 500, `--text-muted`, uppercase, +0.08em
  letter-spacing. Don't go smaller than 12px.
- **Stat-card eyebrow label** — 12px, weight 600, `--text-secondary`
  (heavier than section eyebrows; stat cards are denser).
- **Stat-card value** — Merriweather 700 for "compact" (table-cell) variants;
  the big hero stat values can stay sans.
- **Icon weight** — Material Symbols `wght` 300 for sidebar/inline icons,
  `wght` 400 only when an icon is the primary visual element.
- **Sidebar density** — 6px vertical padding per item, 13px font, 18px icons.
- **Borders** — never use raw hex. Always `var(--border)` (= `--border-primary`).

---

## Verification checklist

After applying step 1:

- [ ] `git diff` shows changes only in `index.html`, `index.css`,
      and a new file at `public/fonts/MaterialSymbolsOutlined.woff2`.
- [ ] `pnpm dev` boots without errors.
- [ ] Sidebar icons render as glyphs (not text like "dashboard", "build").
- [ ] DevTools → Network → reload → no requests to `fonts.googleapis.com`
      for Material Symbols.
- [ ] Theme picker in Settings still works; switching to a few different
      themes (Nord, Carbon, Catppuccin Latte) looks correct and icons
      remain visible.
- [ ] No new console warnings.

---

## File map (this project → repo)

| This project | Repo destination | Action |
|---|---|---|
| `fonts/MaterialSymbolsOutlined.woff2` | `src/ui/web/public/fonts/` | **copy** |
| `tokens/colors_and_type.css` (Material Symbols `@font-face` + `.material-symbols-outlined` rule only) | append to `src/ui/web/src/index.css` | **copy snippet** |
| `tokens/colors_and_type.css` (everything else) | — | reference only |
| `tokens/themes.css` | — | reference only |
| `tokens/theme-picker.js` | — | reference only |
| `previews/*.html`, `kits/*.html` | — | reference only |
| `fonts/*.ttf` (brand fonts) | already in repo at `construct/fonts/` | already present |

That's it. One real change. Everything else is documentation.
