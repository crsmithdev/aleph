---
scope: Any view that renders tabular data (rows of records with shared columns).
applies-to: All existing tables and every new table added to the project.
audit-as: MUST / SHOULD / MAY — "MUST" rules are blocking findings.
---

# Table Design Standards

These rules describe how tables in this project should look and behave. They are framework-agnostic — phrased in terms of visual properties, not CSS class names.

## 1. Structure & Layout

- **MUST** render through the shared table component, not a hand-rolled `<table>`. This is how layout, sorting, pagination, and hover behavior stay consistent across the app.
- **MUST** paginate once the dataset can exceed ~50 rows. Default page size: 50. Do not use infinite scroll or virtualization for standard record tables.
- **MUST** have exactly one "primary" column that expands to fill leftover horizontal space. Every other column is sized to its content.
- **MUST** keep a constant row height across the table (~40px). Rows should never wrap to a second line by default.
- **SHOULD** allow horizontal overflow on narrow viewports rather than squeezing or wrapping columns.

## 2. Columns

- **MUST** left-align text columns and right-align numeric columns — counts, durations, currency, percentages, timestamps formatted as numbers.
- **MUST** render column headers in a visually de-emphasized style: ≤12px, uppercase, wide letter-spacing, muted color. Headers should not compete with row content for attention.
- **MUST** keep header labels short (1–2 words) and Title Case.
- **MUST** make numeric columns, timestamps, and identity columns sortable. Show the active sort column and direction (asc/desc indicator) inline beside the label.
- **MUST** render numeric values in a monospaced typeface so digits align vertically across rows.
- **SHOULD** set a sensible default sort — usually recency (last used / created) descending.

## 3. Cell Content

- **MUST** set primary cell text at a minimum of 14px, at the highest text-contrast tier.
- **MUST** set secondary / meta text (subtitles, hints, supplementary numbers) at ≤12px, at a reduced contrast tier.
- **MUST** route all numbers, dates, durations, and currency through shared formatters — never render a raw value like `1234567` or a raw ISO timestamp. Output must be visually uniform across the app.
- **MUST** truncate long strings with an ellipsis and expose the full value via a native hover tooltip. Hard cap titles at ~100 characters on screen.
- **MUST** render absent values as an em dash (`—`) in a low-contrast color. Never leave a cell visually blank.
- **MUST** keep badges/pills small (≤12px), semibold, with a rounded shape, a pale tinted background, and a subtly stronger border in the same hue. If the badge uses a shorthand glyph (e.g. `2B` for "2 blocks"), it **MUST** also carry a tooltip that spells out the meaning.
- **SHOULD** reserve the first column for the record's primary identity (title, name, or intent). Use the second column for contextual grouping (project, owner, category).

## 4. Rows

- **MUST** zebra-stripe alternate rows using a very subtle alternate background (on the order of 3–5% contrast lift from the base). Striping must be readable in both light and dark modes.
- **MUST** apply a hover affordance *only* when the row is interactive. Non-interactive rows get no hover highlight and no pointer cursor.
- **MUST** make interactive rows navigate to a detail view on click. A row click should not open an inline editor, expand hidden actions, or select a checkbox — detail belongs on its own page.
- **MUST** separate rows with a 1px divider at a lower opacity than structural page borders, so row separators read as subdued.
- **SHOULD** reserve row background tints (beyond zebra stripes) for expanded/active states only. Do not color rows to signal status — use a badge column instead.

## 5. Color & Contrast Tiers

Use a four-tier text hierarchy across every table, defined relative to the row background:

| Tier | Purpose | Relative treatment |
|---|---|---|
| 1 — Primary | Main content: titles, names, intents | Highest contrast |
| 2 — Secondary | Numeric values, project labels, non-title content | One step down |
| 3 — Muted | Headers, timestamps, captions, subtitles | Two steps down |
| 4 — Disabled | Empty-value placeholders, disabled controls | Lowest contrast |

- **MUST** pick every color from the app's semantic palette: neutrals for the four tiers above, plus `error` / `warning` / `success` for status. No raw hex codes, no per-table ad-hoc colors.
- **MUST** pair any status color used for meaning with either a tooltip or a readable text label — color alone is not accessible.

## 6. Empty State

- **MUST** render a centered, low-contrast message when the dataset is empty, rather than showing column headers above an empty body.
- **SHOULD** name the object type in the empty message ("No sessions", "No tools recorded") instead of a generic "No data" when the type is known.

## 7. Page Composition Around a Table

When a table is the primary view on a page, the page **MUST** follow this top-to-bottom order. Skip any section that doesn't apply, but do not reorder:

1. **Controls bar** — filters, time range, dataset switch.
2. **Summary strip** — a row of small stat cards showing the headline metrics the table details (avg, total, count).
3. **Chart / distribution panel** (optional) — time series and/or breakdown visualization.
4. **The table itself.**
5. **Footer line** — query timing, result count, or similar diagnostic.
