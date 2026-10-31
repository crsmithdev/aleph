# UI shots A: shell, Status and Inventory

Part of aleph-669. Shots of `main` (at 564e8d6) plus the fix in d35993d.

## Setup

```
eval "$(bun ui/fixtures/review/build.ts /tmp/fx | sed 's/^/export /')" && bun ui/server.ts --port 3002
aleph-shot http://127.0.0.1:3002/#/ status-1440-light.png --width 1440 --height 900 --scheme light
```

Checked by eye on each PNG: no horizontal scroll, no clipped or overlapping text, no error box from the page's own code (`Could not load`, `failed to render`). aleph-shot does not capture the console, so console errors were not checked.

## Shots

| File | URL | Size | Scheme |
|---|---|---|---|
| status-1440-light.png | `#/` | 1440x900 | light |
| status-1440-dark.png | `#/` | 1440x900 | dark |
| status-390-light.png | `#/` | 390x844 | light |
| status-390-dark.png | `#/` | 390x844 | dark |
| inventory-1440-light.png | `#/inventory` | 1440x900 | light |
| inventory-1440-dark.png | `#/inventory` | 1440x900 | dark |
| inventory-390-light.png | `#/inventory` | 390x844 | light |
| inventory-390-dark.png | `#/inventory` | 390x844 | dark |

## Findings

- status-1440-light.png: the status sentence wraps and nothing clips; no defect (already fixed on main in a1cd4bb, aleph-681)
- status-1440-dark.png: same as light; no defect (a1cd4bb, aleph-681)
- status-390-light.png: nav wraps, no sideways scroll, Aa picker hidden; no defect (main's 059eb68 aleph-683 and 29664cf aleph-685)
- status-390-dark.png: same as light; no defect (059eb68, 29664cf)
- inventory-1440-light.png: the shell rule `.crow` (a grid for card rows) also hit `<tr class="crow">`, so table rows split into pieces and titles clipped to one letter; fixed in d35993d
- inventory-1440-dark.png: same defect as light; fixed in d35993d
- inventory-390-light.png: same `.crow` defect, plus titles cut to 4 characters by the 30ch Labels column; fixed in d35993d (the Labels column scrolls inside the table, the page does not)
- inventory-390-dark.png: same as light; fixed in d35993d
