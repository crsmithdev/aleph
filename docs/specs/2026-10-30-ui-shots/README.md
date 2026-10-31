# UI shots: all pages, both sizes, both schemes

Part of aleph-669. 36 shots: 9 pages x 2 sizes (1440x900, 390x844) x 2 schemes. Shots of `main` between 564e8d6 and ba08b7c plus the fixes named in Findings.

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
| issue-1440-light.png | `#/issues/demo/1` | 1440x900 | light |
| issue-1440-dark.png | `#/issues/demo/1` | 1440x900 | dark |
| issue-390-light.png | `#/issues/demo/1` | 390x844 | light |
| issue-390-dark.png | `#/issues/demo/1` | 390x844 | dark |
| job-1440-light.png | `#/jobs/tools-1` | 1440x900 | light |
| job-1440-dark.png | `#/jobs/tools-1` | 1440x900 | dark |
| job-390-light.png | `#/jobs/tools-1` | 390x844 | light |
| job-390-dark.png | `#/jobs/tools-1` | 390x844 | dark |
| memory-1440-light.png | `#/memory` | 1440x900 | light |
| memory-1440-dark.png | `#/memory` | 1440x900 | dark |
| memory-390-light.png | `#/memory` | 390x844 | light |
| memory-390-dark.png | `#/memory` | 390x844 | dark |
| skills-1440-light.png | `#/skills` | 1440x900 | light |
| skills-1440-dark.png | `#/skills` | 1440x900 | dark |
| skills-390-light.png | `#/skills` | 390x844 | light |
| skills-390-dark.png | `#/skills` | 390x844 | dark |
| sessions-1440-light.png | `#/sessions` | 1440x900 | light |
| sessions-1440-dark.png | `#/sessions` | 1440x900 | dark |
| sessions-390-light.png | `#/sessions` | 390x844 | light |
| sessions-390-dark.png | `#/sessions` | 390x844 | dark |
| session-1440-light.png | `#/sessions/s1` | 1440x900 | light |
| session-1440-dark.png | `#/sessions/s1` | 1440x900 | dark |
| session-390-light.png | `#/sessions/s1` | 390x844 | light |
| session-390-dark.png | `#/sessions/s1` | 390x844 | dark |
| tools-1440-light.png | `#/activity` | 1440x900 | light |
| tools-1440-dark.png | `#/activity` | 1440x900 | dark |
| tools-390-light.png | `#/activity` | 390x844 | light |
| tools-390-dark.png | `#/activity` | 390x844 | dark |

## Findings

- status-1440-light.png: the status sentence wraps and nothing clips; no defect
- status-1440-dark.png: same as light; no defect
- status-390-light.png: nav wraps, no sideways scroll, Aa picker hidden; no defect
- status-390-dark.png: same as light; no defect
- inventory-1440-light.png: the shell rule `.crow` (a grid for card rows) also hit `<tr class="crow">`, so table rows split into pieces and titles clipped to one letter; fixed in 050811e
- inventory-1440-dark.png: same defect as light; fixed in 050811e
- inventory-390-light.png: same `.crow` defect, plus titles cut to 4 characters by the 30ch Labels column (the Labels column now scrolls inside the table, the page does not); fixed in 050811e
- inventory-390-dark.png: same as light; fixed in 050811e
- issue-1440-light.png: content fits, nothing clipped; no defect
- issue-1440-dark.png: content fits, nothing clipped; no defect
- issue-390-light.png: title wraps, Jobs table fits; no defect
- issue-390-dark.png: title wraps, Jobs table fits; no defect
- job-1440-light.png: content fits, nothing clipped; no defect
- job-1440-dark.png: content fits, nothing clipped; no defect
- job-390-light.png: the Runs table scrolls inside its own wrapper (Took, Cost, Started are off to the right), the page does not; no defect
- job-390-dark.png: the Runs table scrolls inside its own wrapper (Took, Cost, Started are off to the right), the page does not; no defect
- memory-1440-light.png: the `+` fold marker sat on its own line above each type heading (the `.sh` block inside `<summary>`); fixed in 4bc411d
- memory-1440-dark.png: the `+` fold marker sat on its own line above each type heading (the `.sh` block inside `<summary>`); fixed in 4bc411d
- memory-390-light.png: the `+` fold marker sat on its own line above each type heading (the `.sh` block inside `<summary>`); fixed in 4bc411d
- memory-390-dark.png: the `+` fold marker sat on its own line above each type heading (the `.sh` block inside `<summary>`); fixed in 4bc411d
- skills-1440-light.png: no defect
- skills-1440-dark.png: no defect
- skills-390-light.png: no defect
- skills-390-dark.png: no defect
- sessions-1440-light.png: no defect
- sessions-1440-dark.png: no defect
- sessions-390-light.png: the table scrolls inside its own box, the page does not; but the shell leaves a blank band of about 230px between the nav and the title (see below); the shell left a blank band between the nav and the title on a short page; fixed in e149d7e
- sessions-390-dark.png: the table scrolls inside its own box, the page does not; but the shell leaves a blank band of about 230px between the nav and the title (see below); the shell left a blank band between the nav and the title on a short page; fixed in e149d7e
- session-1440-light.png: no defect
- session-1440-dark.png: no defect
- session-390-light.png: no defect
- session-390-dark.png: no defect
- tools-1440-light.png: no defect
- tools-1440-dark.png: no defect
- tools-390-light.png: the shell leaves the same blank band above the title; the shell left a blank band between the nav and the title on a short page; fixed in e149d7e
- tools-390-dark.png: the shell leaves the same blank band above the title; the shell left a blank band between the nav and the title on a short page; fixed in e149d7e

Notes: the blank band in the sessions and tools 390 shots is the shell defect of `.shell` (ui/index.html) having `min-height: 100vh` with implicit auto rows at 720px and below; the PNGs show it as shot, e149d7e (aleph-748) fixed it afterwards. Skills needs Langfuse; those shots were taken against a throwaway fake Langfuse (25 slash-command turns for 5 skills; Projects column empty because the fake traces carry no cwd). Sessions shots used a scratch stub Langfuse as in ui/sessions.test.ts.

## What this replaces

These shots replace the 12 old host checks aleph-76, aleph-187, aleph-190, aleph-305, aleph-327, aleph-383, aleph-389, aleph-442, aleph-485, aleph-506, aleph-508 and aleph-583.

aleph-shot does not capture the console. Console errors were therefore checked only as far as the page's own error boxes (`Could not load`, `failed to render`, `Langfuse is unreachable`) show them.
