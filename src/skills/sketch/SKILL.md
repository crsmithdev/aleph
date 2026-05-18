---
name: sketch
description: >
  Build a structured design sketch for an idea, system, or feature and save it
  to the configured sketches directory. Produces a short, opinionated markdown
  document — frame, shape, prior art, open questions — modeled on the
  reference sketches in `docs/sketches/`. Use when the user wants to capture
  an idea before implementing, sketch a feature, or save a design as a
  sketch. Triggers on: "sketch this", "sketch a feature", "sketch an idea",
  "sketch out", "save that as a sketch", "make a sketch", "in
  docs/sketches", "/sketch". NOT for: full implementation plans (write a
  plan), post-hoc design review (use `design-review`), or polishing existing
  designs (use `design-review`).
---

# Sketch

Capture an idea as a slim, opinionated markdown sketch — not a plan, not a
spec. The point is to make the shape of the idea legible enough to argue
about, with the minimum useful structure.

## When to Use

- The user wants to record an idea before building it
- They say "sketch this", "sketch a feature", "save that as a sketch"
- A design has emerged in conversation and needs a durable artifact
- The user types `/sketch` (this skill mirrors `src/commands/sketch.md`)

## Do NOT Use For

- Multi-step implementation planning — write a plan or PR description
- Reviewing or auditing an existing design — use `design-review`
- Code-level proposals — write the code

## Procedure

### 1. Resolve the output directory

Read `~/.claude/construct/core/construct.config.json` and pick
`sketches.outputDir`. Expand `~` to `$HOME`. `mkdir -p` if missing.

### 2. Resolve the subject

- `$ARGUMENTS` non-empty → use it.
- Empty → infer from the current conversation. Summarize in 3–6 words for
  the title and filename.
- Slugify: lowercase, spaces → hyphens, strip punctuation.
  Example: `inbox and share` → `inbox-and-share.md`.

### 3. Write the sketch

Model on the references in `docs/sketches/`. Every sketch has:

1. **Title** (`# <subject>`) plus a one-paragraph framing of the core
   tension or opportunity in plain terms
2. **The frame** — what problem this solves, who it's for, what makes it
   hard
3. **Shape** — concrete structure: data shape, API shape, component shape,
   or install recipe, depending on type. Use code blocks for anything
   structural
4. **Prior art** — what already exists that overlaps; tool names and links
   if known. Note what each covers and what it doesn't
5. **Open questions** — numbered list of unresolved decisions that would
   change the design

Write for depth, not length. Cut any section that has nothing to say. Add
sections the idea needs (e.g. **Gotchas** for install recipes, **Protocol**
for network designs). Match the tone of the reference sketches: specific,
opinionated, no filler. No planning sections, no roadmaps, no phases.

### 4. Save

Write to `<outputDir>/<slug>.md` via the `Write` tool.

### 5. Report

Print exactly one line:

```
→ <absolute-path>
```

## Guardrails

- Don't pad. A 30-line sketch that says something is better than a 200-line
  sketch that says nothing.
- Don't propose. Sketches frame; they don't commit.
- Don't overwrite an existing sketch silently — if the target slug exists,
  pick a suffix (`-v2`, `-alt`) or ask.
