# Status layout C: shots at 2400 and 1440 px

Fixture: `bun ui/fixtures/review/build.ts /tmp/fx`; server: `bun ui/server.ts --port 3002`. Shots by `aleph-shot` with `--width W --height H --scheme S`. Part of aleph-599.

| File | URL | Size | Scheme |
| --- | --- | --- | --- |
| status-2400-light.png | http://127.0.0.1:3002/#/ | 2400x1500 | light |
| status-2400-dark.png | http://127.0.0.1:3002/#/ | 2400x1500 | dark |
| status-1440-light.png | http://127.0.0.1:3002/#/ | 1440x900 | light |
| status-1440-dark.png | http://127.0.0.1:3002/#/ | 1440x900 | dark |

- status-2400-light.png: header, Needs you and flow row full width on top; below, Speed (five cards, three charts in one row) above Efficiency on the left, the four lanes (Incoming, Queued, Running, Done) stacked in one right-hand column about a third wide, 40 px gap, tops aligned. Matches C.
- status-2400-dark.png: same arrangement as the light shot. Matches C.
- status-1440-light.png: single column: Speed, Efficiency, then the four lanes in one row of four (visible at the fold bottom); the hours bar is below the fold, accepted. Matches the pre-C order.
- status-1440-dark.png: same as the light shot. Matches.

## Differences found

None, so no fix commit. Limit: the fixture has no agent runs in the period ("No agent run of a goal ended in this period."), so the agent-time bar and the pinned detail card do not render; the bar-left, detail-right arrangement (`.effbody` rule) is not seen in these shots.
