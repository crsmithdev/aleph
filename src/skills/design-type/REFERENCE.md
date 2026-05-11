# UI Typography — Complete Reference

These rules are distilled from **Matthew Butterick's *Practical Typography*** (https://practicaltypography.com). They are permanent rules, not trends — centuries of typographic practice validated by how the human eye reads.

---

## Characters

### Quotes and Apostrophes — Always Curly

Straight quotes are typewriter artifacts. Use `&ldquo;` `&rdquo;` for double, `&lsquo;` `&rsquo;` for single.

Apostrophes always point down — identical to closing single quote `&rsquo;`. Smart-quote engines wrongly insert opening quotes before decade abbreviations ('70s) and word-initial contractions ('n'). Fix with explicit `&rsquo;`.

The `<q>` tag auto-applies curly quotes when `<html lang="en">` is set.

### JSX/React Implementation Warning

Unicode escape sequences (`\u2019`, `\u201C`, etc.) do NOT work in JSX text content. They render as literal characters. JSX text between tags is treated as string literals by the transpiler, not JavaScript expressions.

**What works:**
1. Actual UTF-8 characters (preferred) — paste the real character directly
2. JSX expression: `Don{'\u2019'}t do this`
3. HTML entity (HTML files only): `&rsquo;` — does NOT work in JSX/React

### Dashes and Hyphens — Three Distinct Characters

| Character | HTML | Use |
|-----------|------|-----|
| - (hyphen) | `-` | Compound words (cost-effective), line breaks |
| -- (en dash) | `&ndash;` | Ranges (1--10), connections (Sarbanes--Oxley Act) |
| --- (em dash) | `&mdash;` | Sentence breaks---like this |

Never approximate with `--` or `---`. Hyphenate phrasal adjectives (five-dollar bills). No hyphen after -ly adverbs.

### Ellipses — One Character

Use `&hellip;`, not three periods. Spaces before and after; use `&nbsp;` on the text-adjacent side.

### Math and Measurement

Use `&times;` for multiplication, `&minus;` for subtraction. Foot and inch marks are the ONE exception to curly quotes — must be STRAIGHT: `&#39;` for foot, `&quot;` for inch.

### Trademark and Copyright

Real symbols: `&copy;` `&trade;` `&reg;`, never (c) (TM) (R). "Copyright (c)" is redundant — word OR symbol.

### Other Punctuation

- Semicolons join independent clauses. Colons introduce completion.
- Exclamation points: budget ONE per long document. Never multiple in a row.
- Ampersands: correct in proper names only. Write "and" in body text.

---

## Spacing

### One Space After Punctuation — Always

Never two. The period already contains visual white space.

### Nonbreaking Spaces

`&nbsp;` prevents line break. Use before numeric refs (`&sect;&nbsp;42`), after (c) (`&copy;&nbsp;2025`), after honorifics (`Dr.&nbsp;Smith`), between foot/inch values.

---

## Text Formatting

### Bold and Italic

Bold OR italic. Mutually exclusive. Never combine. Use as little as possible — if everything is emphasized, nothing is. Sans serif: bold only — italic sans barely stands out.

### Underlining — Never

Never underline in a document or UI. For web links: `text-decoration-thickness: 1px; text-underline-offset: 2px`.

### All Caps — Less Than One Line, Always Letterspaced

ALWAYS add 5--12% letterspacing. ALWAYS ensure kerning is on. NEVER capitalize whole paragraphs. CSS: `letter-spacing: 0.06em`.

### Small Caps — Real Only

Never fake (scaled-down regular caps). Use `font-variant-caps: small-caps` with fonts that have real small caps (OpenType `smcp`).

### Letterspacing

5--12% extra on ALL CAPS and small caps. Nothing on lowercase.

### Kerning — Always On

`font-feature-settings: "kern" 1; text-rendering: optimizeLegibility;`

### Alternate Figures

Tabular (`"tnum"`) for data tables. Oldstyle (`"onum"`) for body text. `font-variant-numeric: tabular-nums lining-nums` for numeric tables.

### Font Selection

1. No goofy fonts (novelty, script, handwriting) in professional work
2. No monospaced for body text — code only
3. Max 2 fonts. Each gets a consistent role

---

## Page Layout

### Body Text First

Set body text BEFORE anything else. Four decisions determine everything: font, point size, line spacing, line length.

### Line Length — 45--90 Characters

The #1 readability factor. CSS: `max-width: 65ch` on text containers.

### Line Spacing — 120--145% of Point Size

`line-height: 1.2` to `1.45`.

### Text Alignment

Left-align for web (default). Justified requires `hyphens: auto`. Centered: sparingly, only for short titles (< 1 line).

### Paragraph Separation — Indent OR Space, Never Both

First-line indent: `text-indent: 1.5em`. Space between: `margin-bottom: 0.75em`.

### Headings — Max 3 Levels

1. Bold, not italic — stands out better
2. Smallest point-size increment needed (body 11pt -> heading 13pt, not 18pt)
3. `hyphens: none` on headings
4. Space above > space below (heading relates to text that follows)
5. Use `text-wrap: balance` or `text-pretty` (prevents widows)

### Tables — Remove Borders, Add Padding

Data creates an implied grid. Borders add clutter. Keep only thin rule under header. `padding: 0.5em 1em`. Tabular figures for numeric columns. Right-align numbers.

---

## Responsive Web Typography

The rules don't change with screen size.

1. Scale `font-size` and container `width` together
2. Always `max-width` on text containers — never edge-to-edge text
3. `clamp()` for fluid scaling: `font-size: clamp(16px, 2.5vw, 20px)`
4. Mobile minimum: `padding: 0 1rem` on text containers

---

## Dark Mode

- `color-scheme: dark` on `<html>` for dark themes
- Reduce weight slightly — dark bg makes text appear heavier
- `-webkit-font-smoothing: auto` in dark mode (let system decide)

---

## Maxims

1. **Body text first** — its 4 properties determine everything
2. **Foreground vs background** — don't let chrome upstage body text
3. **Smallest visible increments** — half-points matter
4. **Consistency** — same things look the same
5. **Keep it simple** — 3 colors and 5 fonts? Think again
6. **Imitate what you like** — emulate good typography from the wild
