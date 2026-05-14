---
description: Read the user's latest screenshot (Greenshot → ~/shots) and optionally answer a question about it
---

Resolve the most recent screenshot by running `~/.local/bin/latest-shot` (one-liner: `ls -t ~/shots/*.png | head -1`). Then Read the resulting path so the image is in context.

If `$ARGUMENTS` is non-empty, treat it as the user's question about the screenshot and answer it directly after reading.

If `latest-shot` returns nothing, say so plainly — don't fabricate.
