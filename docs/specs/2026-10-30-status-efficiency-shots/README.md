# Shots of the Status efficiency view (aleph-613)

## Setup

```sh
eval "$(bun ui/fixtures/review/build.ts /tmp/fx | sed 's/^/export /')" && bun ui/server.ts --port 3002
```

The build prints `ALEPH_JOBS_DIR`, `ALEPH_REPOS`, `ALEPH_ITEMS` and `ALEPH_VAULT`, which the server must export to read the fixture runs. Cause of aleph-609's empty "No agent run" view: the old setup line started the server without them, so `/api/speed?window=week` had no hours (reproduced 2026-10-30); with them, `landed` and `dropped` report 0.33 h each.

## Shots at 2400 px (aleph-615)

Server on port 3002 with the fixture env above. `curl /api/speed?window=week` listed four classes with hours: landed 0.33, fixed 0.33, nothing 0.33, dropped 1.08 (loop and restarted 0).

| File | URL | Size | Scheme | Click |
|---|---|---|---|---|
| `efficiency-2400-light.png` | `http://127.0.0.1:3002/#/` | 2400x2200 | light | none |
| `efficiency-2400-dark.png` | `http://127.0.0.1:3002/#/` | 2400x2200 | dark | none |
| `efficiency-2400-pinned-light.png` | `http://127.0.0.1:3002/#/` | 2400x2200 | light | `.abar button[data-class="nothing"]` |

- light: bar segments Landed, Fixed in place, Nothing to do, Dropped (1.1 h · 52%); detail card is the default class, Dropped (1.1 h, 3 runs, 2 goals), 3 cause rows (Checks failed, Other, No commit), 2 goal rows (demo-10, demo-2).
- dark: same content as light in the dark scheme.
- pinned-light: same bar, "Nothing to do" segment outlined (pinned); detail card is Nothing to do (0.3 h, 1 run, 1 goal), 1 cause row (Goal had landed), 1 goal row (demo-1).

Arrangement: matches aleph-608. At 2400 px the bar (left, about 579 px) and `section.brk` (right, about 579 px) sit side by side in one row, two equal columns with a 24 px gap (`.effbody`, `ui/index.html:218`). In the detail, `By cause` and `Goals that took the most` stack in one column. No difference found, so no follow-up filed; layout unchanged.
