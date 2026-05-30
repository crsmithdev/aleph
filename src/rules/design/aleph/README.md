# Aleph Design System

Aleph is a personal life-OS plus AI-research workspace. This project is the design system: tokens, foundations, and UI kits that every screen of the product is built from.

## File index

| Path | Purpose |
|---|---|
| `tokens/colors_and_type.css` | Single source of truth — color tokens (themed), font stacks, spacing, radii, layout. |
| `previews/foundations.html` | Identity, surfaces, color, type, spacing, iconography. |
| `previews/components.html` | Buttons, badges, inputs, tables, charts, status pills. |
| `previews/page_chrome.html` | Sidebar, page header, observability control bar. |
| `kits/life.html` | Summary, goals, todos, habits. |
| `kits/research.html` | Investigate, run detail, history. |
| `kits/observability.html` | Tools, span trace, sessions list. |

## Theming

All color tokens live inside `[data-theme="…"]` blocks in `tokens/colors_and_type.css`. To add a preset, copy the dark block and rewrite values — UI code only references semantic names (`--bg-secondary`, `--accent`, etc), never raw hex.

## Content fundamentals

- **Audience of one.** The user is themselves. No marketing voice, no onboarding pep.
- **Density over comfort.** Power-user surfaces; small type, tight spacing, scannable rows.
- **Numbers earn the serif.** Merriweather for stat numerics; Noto Sans for everything else.
- **Hierarchy by value, not size.** Four greys do most of the work. Color carries meaning, not decoration.
- **No filler.** No empty-state mascots, no decorative illustrations, no badge soup.

## Visual foundations

- **Three-tier surfaces:** `--bg-primary` (floor) → `--bg-secondary` (cards) → `--bg-tertiary` (hover/inputs/nested).
- **Semantic accents:** `--accent` blue (primary action), `--success`, `--warning`, `--error`, `--info`, `--magenta` (habits only — the one personality color).
- **Radii:** small. 2 / 4 / 8 / 12. Aleph doesn't pillow.
- **Spacing:** 4px base; rarely larger than 16. Tight by default.
- **No drop shadows.** Depth comes from value steps and 1px borders.

## Iconography

Material Symbols Outlined, weight 300, opsz 20. Filled variants only for active/selected states. No custom icon sets, no SVG illustrations in product chrome.

> **Known issue:** the Material Symbols icon font is loaded from Google Fonts via CSS `@import`. In some sandboxed previews this font does not resolve and icon names render as raw text (`dashboard`, `target`, etc) instead of glyphs. The production app should ship the font file locally or via `<link>` with `crossorigin` set. See `tokens/icons.html` for an inline-SVG fallback set.
