# Findings list

The findings list shows the numbered findings of a Monitor report.

- Use: for a Monitor report.
- Not for: other lists; use a table or `moreFold()`.

## Helper

| Helper | Reference |
|---|---|
| `findingsList(findings)` in `ui/views/lib/feed.js`, one `findingHtml()` `<li>` each in `<ol class="findings">` | `ui/views/gates.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Fold | The report |  | a closed fold; the summary gives the day and the count |
| Finding | One finding |  | `--ink-2`, line height 1.35; `--sp-4` apart |

## Rules

- Keep the fold closed.

## Do and don't

| Do | Don't |
|---|---|
| `findingsList(findings)` | a finding list built in the view |
