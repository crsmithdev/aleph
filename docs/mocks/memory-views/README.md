# Memory view mocks

Design mocks for three new memory views, from Chris's request on 2026-11-12. The live canvas is the Design artifact
https://claude.ai/artifact/YP21B6MiU1jH62zP1m9yWv. These files are its source: `canvas.json` and one `.dc.html` per
board. They need the canvas runtime (`support.js`) to render, so open the artifact to see them.

| Board | File | Shows |
|---|---|---|
| 1 · Memory: tabs, Search | `Main.dc.html` | The `#/memory` page gets four tabs. Search is the page of today, unchanged. |
| 2 · Context inspector | `Context.dc.html` | A session and request picker, the fill from API usage, the fill per request, and the parts of one request. |
| 3 · Memory log | `Log.dc.html` | Writes, recalls, misses and prunes in one table, with a recall row opened. |
| 4 · Processes | `Processes.dc.html` | The scheduled steps, then one card each for episodes, corrections, the contradiction screen and decay. |

Not built. Values on the boards are samples, except where a board names a real count.

## Exact and estimated

- The total fill of a request is exact. It is input + cache read + cache write from the transcript usage.
- Each message is exact. Its size is the usage of its request minus the usage of the request before it.
- The fixed parts of request 1 (system prompt, tools, instructions, memory) are exact as a sum. Their split is an
  estimate, chars ÷ 4, because the repo has no tokenizer.
