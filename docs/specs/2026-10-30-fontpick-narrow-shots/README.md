# Before shots of the Aa button at 390 px and 1440 px

Part of aleph-682. Taken from `main` (852ab09) before the fix, as the "before" half of the evidence.

Fixture and server: `eval "$(bun ui/fixtures/review/build.ts /tmp/fx | sed 's/^/export /')" && bun ui/server.ts --port 3002` (the build prints the ALEPH_* variables the server needs to read the fixture runs). Shots by `aleph-shot`, light scheme, 390x844 and 1440x900.

| File | URL | Width | Scheme |
| --- | --- | --- | --- |
| status-390-before-light.png | http://127.0.0.1:3002/#/ | 390 | light |
| status-1440-before-light.png | http://127.0.0.1:3002/#/ | 1440 | light |

## Findings

- status-390-before-light.png: The Aa button (the fixed bottom-right font picker trigger) sits over the Status page text at the right edge. It covers the end of "stays open." in the "Discards the run's branch; the issue stays open." line of the first Needs-you card, and the card's right edge runs under it. This is the problem aleph-682 fixes.
- status-1440-before-light.png: The Aa button sits in the right gutter, clear of the page text. No overlap at this width, so the defect is specific to the narrow viewport.
