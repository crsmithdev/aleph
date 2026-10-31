# UI shots B: one issue page and one job page

Part of aleph-669. Shots of `main` at 050811e, no source change. Setup as in README.md (fixture from `ui/fixtures/review/build.ts`, server on port 3002). Both routes load against the fixture; no other item or run was needed.

Checked by eye on each PNG: no horizontal scroll, no clipped or overlapping text, no `Could not load` or `failed to render` box. aleph-shot does not capture the console, so console errors were not checked.

| File | URL | Size | Scheme |
|---|---|---|---|
| issue-1440-light.png | `#/issues/demo/1` | 1440x900 | light |
| issue-1440-dark.png | `#/issues/demo/1` | 1440x900 | dark |
| issue-390-light.png | `#/issues/demo/1` | 390x844 | light |
| issue-390-dark.png | `#/issues/demo/1` | 390x844 | dark |
| job-1440-light.png | `#/jobs/tools-1` | 1440x900 | light |
| job-1440-dark.png | `#/jobs/tools-1` | 1440x900 | dark |
| job-390-light.png | `#/jobs/tools-1` | 390x844 | light |
| job-390-dark.png | `#/jobs/tools-1` | 390x844 | dark |

## Findings

- issue-1440-light.png: content fits, nothing clipped; no defect
- issue-1440-dark.png: content fits, nothing clipped; no defect
- issue-390-light.png: title wraps, Jobs table fits; no defect
- issue-390-dark.png: title wraps, Jobs table fits; no defect
- job-1440-light.png: content fits, nothing clipped; no defect
- job-1440-dark.png: content fits, nothing clipped; no defect
- job-390-light.png: the Runs table scrolls inside its own wrapper (Took, Cost, Started are off to the right), the page does not; no defect
- job-390-dark.png: the Runs table scrolls inside its own wrapper (Took, Cost, Started are off to the right), the page does not; no defect
