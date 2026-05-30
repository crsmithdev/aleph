# Aleph Design System Rules

Project-specific UI rules for the Aleph codebase. Walked by `design-review`:
- **Review path** — scan UI source for violations (inline hex, drop shadows, wrong type pairing, etc.), present findings, apply approved fixes, gate on `bun run ui:smoke`. Audit and fix are one continuous flow inside a single skill invocation.
- **Enforce path** — applied silently while the agent is writing or editing UI source. No findings, no diff.

Sibling assets — `tokens/`, `kits/`, `previews/`, `fonts/` — are the visual specs and runtime values these rules reference.

When designing for **aleph**, follow these rules.

## Always

- Link `tokens/colors_and_type.css` at the top of every HTML file you write inside this project. All colors, fonts, spacing, and radii come from CSS custom properties defined there.
- Reference colors only via tokens (`var(--bg-secondary)`, `var(--accent)`, `var(--text-muted)`). Never inline hex.
- Use the three-tier surface system: `--bg-primary` for the page floor, `--bg-secondary` for cards/panels, `--bg-tertiary` for hover/inputs/nested chrome.
- Hierarchy via value: `--text-primary` for headings & body, `--text-secondary` for supporting copy, `--text-muted` for meta/timestamps. Avoid `--text-disabled` for anything live.
- Use `--font-heading` (Merriweather) only for stat numerics and the wordmark. Default to `--font-sans`. `--font-mono` for IDs, hashes, paths, code.
- Numerics in tables: add `font-variant-numeric: tabular-nums` so columns align.
- Default body size 14px. Minimum 12px (mono captions). Never below.
- Radii stay small: 2/4/8/12. Cards use 8, modals use 12.

## Never

- Drop shadows. Use 1px borders or value steps instead.
- Gradient backgrounds outside the Investigate hero (`linear-gradient` to `--bg-secondary`).
- Emoji. Use Material Symbols or inline SVG.
- Decorative illustrations in product chrome.
- New colors. If you need something, derive from existing tokens or extend the theme block.
- Magenta on anything except habits. It's the single personality color.

## Theme swapping

Set `data-theme="dark"` (default) or `data-theme="light"` on `<html>` or any ancestor. Adding a new preset = copy a theme block in `tokens/colors_and_type.css` and rewrite values; nothing else changes.

## Icon fallback

If Material Symbols isn't rendering (sandboxed environments), use the inline SVG `<symbol>` defs in `tokens/icons.html`. Include the file once per page, then `<svg class="icon"><use href="#i-target"/></svg>`.

## Component reference

- `previews/components.html` — buttons, inputs, badges, tables, charts.
- `previews/page_chrome.html` — sidebar, header, observability control bar.
- `kits/*.html` — full screens showing the system in use.

When recreating a screen, start from a kit and substitute content — don't redesign the chrome.
