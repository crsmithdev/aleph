# Theme palettes

Request (the user, 2026-11-20): list 20 to 30 popular colour themes with colour previews, to choose which become palettes
of the dock's theme picker.

- 27 entries: aleph's own Lavender and 26 editor themes. `build.py` holds each as aleph's ten palette tokens and
  writes `index.html`; `head.html` is the page shell.
- Each theme maps onto the ten tokens a palette sets (`design.md`, Palettes): `--bg`, `--surface`, `--sunk`,
  `--raised`, `--ink`, `--ink-2`, `--muted`, `--rule`, `--rule-2`, `--focus`.
- The status chips keep aleph's colours in every preview, because a palette does not set a status colour
  (`design.md`, Palettes).
- Muted text is lifted where a theme's comment colour is too faint for body text, so the previews hold aleph's
  contrast rule (`design.md`, Contrast). The other values follow each theme's published palette.
- A dark-only theme shows no light preview. It needs a light pair before it can be a palette.
- Each theme section has `data-annotate="theme/<n>"`, so a note pins to a theme.

The hex values come from memory of each theme's published palette. They were not fetched from the theme repos.

## Round 2

The user picked 1 to 4, 6, 8, 17, 21, 22 and 25, and asked for Nord and Palenight variations. Entries 28 to 34 add them.
Their values were read from each theme's source file, which `build.py` names; muted text is lifted where the
source's comment colour is too faint for body text. Nordic and Nordfox are dark only and pair with Nord Light.
