---
description: Build a design sketch for an idea and save it to the configured sketches directory
---

Generate a structured design sketch. Parse the subject from: $ARGUMENTS

## Setup

Read the output directory from `~/.claude/construct/core/construct.config.json` (key: `sketches.outputDir`). Expand `~` to `$HOME`. Create the directory with `mkdir -p` if it doesn't exist.

**Subject:** If `$ARGUMENTS` is non-empty, use it as the topic. If empty, infer the topic from the current conversation — what idea, system, or problem has been under discussion. Summarize it in a short phrase (3–6 words) for the title and filename.

Slugify the subject into a filename: lowercase, spaces → hyphens, strip punctuation. Example: "inbox and share" → `inbox-and-share.md`.

## Sketch format

Write a markdown document modeled on the sketches in `~/construct/docs/sketches/`. Every sketch has:

1. **Title line** (`# <subject>`) plus a one-paragraph framing that states the core tension or opportunity in plain terms
2. **The frame** — what problem this solves, who it's for, what makes it hard
3. **Shape** — concrete structure: data shape, API shape, component shape, or install recipe, depending on the type. Use code blocks for anything structural
4. **Prior art** — what already exists that overlaps; tool names, links if known. Note what each covers and what it doesn't
5. **Open questions** — numbered list of unresolved decisions that would change the design

Write for depth, not length. Cut any section that has nothing to say. Add sections the idea needs (e.g. a "Gotchas" section for install recipes, a "Protocol" section for network designs). Follow the tone and density of the reference sketches: specific, opinionated, no filler. No planning sections, no roadmaps, no phases.

## Output

Write the sketch to `<outputDir>/<slug>.md` using the Write tool.

After writing, print one line: `→ <absolute-path>`
