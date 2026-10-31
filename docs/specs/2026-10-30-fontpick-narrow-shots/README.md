# Shots of the Aa button at 390 px and 1440 px

Part of aleph-682. The "before" shots were taken from `main` (852ab09) before the fix. The "after" shots were taken with the `.fontpick` hide rule from aleph-685 (29664cf, on `main`) in place.

Fixture and server: `eval "$(bun ui/fixtures/review/build.ts /tmp/fx | sed 's/^/export /')" && bun ui/server.ts --port 3002` (the build prints the ALEPH_* variables the server needs to read the fixture runs). Shots by `aleph-shot`, light scheme, 390x844 and 1440x900.

| File | URL | Width | Scheme |
| --- | --- | --- | --- |
| status-390-before-light.png | http://127.0.0.1:3002/#/ | 390 | light |
| status-1440-before-light.png | http://127.0.0.1:3002/#/ | 1440 | light |
| status-390-after-light.png | http://127.0.0.1:3002/#/ | 390 | light |
| status-1440-after-light.png | http://127.0.0.1:3002/#/ | 1440 | light |

## Findings

- status-390-before-light.png: The Aa button (the fixed bottom-right font picker trigger) sits over the Status page text at the right edge. It covers the end of "stays open." in the "Discards the run's branch; the issue stays open." line of the first Needs-you card, and the card's right edge runs under it. This is the problem aleph-682 fixes.
- status-1440-before-light.png: The Aa button sits in the right gutter, clear of the page text. No overlap at this width, so the defect is specific to the narrow viewport.
- status-390-after-light.png: After the fix, there is no Aa button. The page text runs clear to the 16 px padding at the right edge, and the Needs-you card edges no longer sit under a floating control. The overlap is gone.
- status-1440-after-light.png: The Aa button still sits in the right gutter, unchanged from the before shot. The fix only hides the picker at 720 px and below, so the wide layout is untouched.
