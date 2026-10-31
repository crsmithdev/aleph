# UI shots C: Memory and Skills

Part of aleph-669. Shots of `main` at ba08b7c plus the fix in 4bc411d.

## Setup

Same as README.md (review fixture, `bun ui/server.ts --port 3002`). Memory reads the fixture vault. Skills needs Langfuse: with no keys `/api/skills` answers 502 and the page shows `Could not load Skills` (by design, not a view defect). The skills shots were taken with a throwaway fake Langfuse on 127.0.0.1:3999 (`LANGFUSE_BASE_URL`, dummy keys, `ALEPH_SKILLS_STORE=/tmp/lf/store.json`) that serves 25 slash-command turns for 5 of the repo's skills/ folders. The Projects column is empty because the fake traces carry no cwd.

Checked by eye on each PNG: no horizontal scroll of the page, no clipped or overlapping text, no error box. The 390px Skills table scrolls inside its own `.tscroll` box (Sessions, Errors, Per day, Last used are off to the right). Console errors were not checked.

## Shots

| File | URL | Size | Scheme |
|---|---|---|---|
| memory-1440-light.png | `#/memory` | 1440x900 | light |
| memory-1440-dark.png | `#/memory` | 1440x900 | dark |
| memory-390-light.png | `#/memory` | 390x844 | light |
| memory-390-dark.png | `#/memory` | 390x844 | dark |
| skills-1440-light.png | `#/skills` | 1440x900 | light |
| skills-1440-dark.png | `#/skills` | 1440x900 | dark |
| skills-390-light.png | `#/skills` | 390x844 | light |
| skills-390-dark.png | `#/skills` | 390x844 | dark |

## Findings

- memory-1440-light.png: the `+` fold marker sat on its own line above each type heading (the `.sh` block inside `<summary>`); fixed in 4bc411d
- memory-1440-dark.png: the `+` fold marker sat on its own line above each type heading (the `.sh` block inside `<summary>`); fixed in 4bc411d
- memory-390-light.png: the `+` fold marker sat on its own line above each type heading (the `.sh` block inside `<summary>`); fixed in 4bc411d
- memory-390-dark.png: the `+` fold marker sat on its own line above each type heading (the `.sh` block inside `<summary>`); fixed in 4bc411d
- skills-1440-light.png: no defect
- skills-1440-dark.png: no defect
- skills-390-light.png: no defect
- skills-390-dark.png: no defect
