# Theme palettes

Request (Chris, 2026-11-20): list 20 to 30 popular colour themes with colour previews, to choose which become palettes
of the dock's theme picker.

- 27 entries: aleph's own Lavender and 26 editor themes. `build.py` holds each as aleph's ten palette tokens and
  writes `index.html`; `head.html` is the page shell.
- Each theme maps onto the ten tokens a palette sets (`docs/design.md`, Palettes): `--bg`, `--surface`, `--sunk`,
  `--raised`, `--ink`, `--ink-2`, `--muted`, `--rule`, `--rule-2`, `--focus`.
- The status chips keep aleph's colours in every preview, because a palette does not set a status colour
  (`docs/design.md`, Palettes).
- Muted text is lifted where a theme's comment colour is too faint for body text, so the previews hold aleph's
  contrast rule (`docs/design.md`, Contrast). The other values follow each theme's published palette.
- A dark-only theme shows no light preview. It needs a light pair before it can be a palette.
- Each theme section has `data-annotate="theme/<n>"`, so a note pins to a theme.

The hex values come from memory of each theme's published palette. They were not fetched from the theme repos.
