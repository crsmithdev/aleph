---
name: mock
description: "Mock: build a design draft (HTML pages, images, a canvas) for Chris, put it on the shelf and wait for his notes. Use when Chris asks for a mock, or when design options need to be shown."
---

# Mock

A mock is a design draft for Chris: HTML pages, images, a canvas.

- Keep it in the repo at `docs/mocks/<name>/`, never in `/tmp` or the scratchpad, and commit it.
- Its `README.md` names the request and each decision, and cites the design rule behind each one.
- Use the repo's design rules. In aleph, these are the tokens and classes of `ui/app.css` and the components of
  `design/components/` and `design/rules.md`.

## Show it

1. Put the mock on the shelf and open the URL it prints:

   ```bash
   shelf put docs/mocks/<name> --title "<title>" --kind mock
   cd /mnt/c && /mnt/c/Windows/System32/cmd.exe /c start "" "<url>"
   ```

2. Run `shelf wait <id>` with `run_in_background`. Exit 0 prints Chris's notes.
3. Put a changed mock on the shelf again.

If `put` fails, serve the directory with `python3 -m http.server <port> -d docs/mocks/<name>` on a free port at or
above 3002.
