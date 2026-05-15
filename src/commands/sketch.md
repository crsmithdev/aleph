---
description: Build a design sketch for an idea and save it to the configured sketches directory
---

Generate a structured design sketch for the idea in: $ARGUMENTS

## Setup

Read the output directory from `~/.claude/construct/core/sketch.config.json` (key: `outputDir`). Expand `~` to `$HOME`. Create the directory with `mkdir -p` if it doesn't exist.

Slugify the idea into a filename: lowercase, spaces → hyphens, strip punctuation. Example: "shell stack setup" → `shell-stack-setup.md`.

If `$ARGUMENTS` is empty, ask the user for an idea before proceeding.

## Sketch format

Write a markdown document modeled on the sketches in `~/construct/docs/sketches/`. Every sketch has:

1. **Title line** (`# <idea name>`) plus a one-paragraph framing that states the core tension or opportunity in plain terms
2. **The frame** — what problem this solves, who it's for, what makes it hard
3. **Shape** — concrete structure: data shape, API shape, component shape, or install recipe, depending on the idea type. Use code blocks for anything structural
4. **Phased build** — ordered phases A, B, C, … each as a one-liner of the minimum deliverable for that phase
5. **Prior art** — list what already exists that overlaps; be specific (tool names, links if known). Note what each covers and what it doesn't
6. **Open questions** — numbered list of unresolved decisions that would change the design

Write for depth, not length. Cut any section that has nothing to say. Add sections that the idea needs (e.g. a "Gotchas" section for install recipes, a "Protocol" section for network designs). Follow the tone and density of the reference sketches: specific, opinionated, no filler.

## Output

Write the sketch to `<outputDir>/<slug>.md` using the Write tool.

After writing, print one line: `→ <absolute-path>` so the user knows where it landed.
