---
name: sketch
description: >
  Capture an idea as a slim, opinionated markdown sketch — the shape of a
  thing, not a plan to build it. Triggers a short discovery dialogue when the
  request is ambiguous, then writes a 5-section sketch (frame, shape, prior
  art, open questions, plus topic-specific sections) to
  `~/.aleph/sketches/<slug>.md`. Use when the user wants to record an
  idea before building it: "sketch this", "sketch a feature", "sketch an
  idea", "sketch out", "save that as a sketch", "make a sketch",
  `/sketch`. NOT for: implementation plans with file paths and verification
  (use `/plan`); reviewing existing designs (use `design-review`); writing
  code. A sketch frames the WHAT; a plan describes the HOW.
---

# Sketch

Capture an idea. Frame it well enough to argue about. Stop before
implementation.

## When to Use

- The user wants to record an idea before building it
- They say "sketch this", "sketch a feature", "save that as a sketch"
- A design has emerged in conversation and needs a durable artifact
- The user types `/sketch`

## Do NOT Use For

- Multi-step implementation planning — use `/plan`
- Reviewing or auditing an existing design — use `design-review`
- Code-level proposals — write the code

## Procedure

### 1. Assess clarity, ask if needed

Read the conversation and `$ARGUMENTS`. Decide whether you have enough to
write a sketch that says something.

You have enough when you can answer, from the conversation alone:

- **What** — what's the idea, in one sentence?
- **Why** — what problem does it solve, or what tension does it resolve?
- **Who** — who is this for?
- **Shape** — what kind of artifact is this (feature, system, protocol,
  CLI, integration, mental model)?

If any of these is unclear, ask 3–5 short questions in a single message
before writing. Tailor them — don't dump a template. Stop asking once you
can write something opinionated. If the user redirects mid-question, skip
the rest.

### 2. Resolve output

Read `~/.claude/aleph/core/aleph.config.json` and pick
`sketches.outputDir`. Expand `~` to `$HOME`. `mkdir -p` if missing.

Slugify the subject for the filename: lowercase, spaces → hyphens, strip
punctuation. Example: `inbox and share` → `inbox-and-share.md`. If the slug
collides with an existing file, suffix (`-v2`, `-alt`) or ask.

### 3. Write the sketch

Model on `~/construct/docs/sketches/`. Every sketch has:

1. **Title** (`# <subject>`) plus one paragraph framing the core tension or
   opportunity in plain terms
2. **The frame** — what problem this solves, who it's for, what makes it
   hard
3. **Shape** — illustrative structure: data shape, API shape, component
   shape, install recipe, protocol — whichever fits. Use code blocks for
   anything structural. Show the *kind* of thing, not the file paths.
4. **Prior art** — what already exists that overlaps; tool names, links if
   known. Note what each covers and what it doesn't.
5. **Open questions** — numbered list of unresolved decisions that would
   change the design

Write for depth, not length. Cut any section that has nothing to say. Add
sections the idea needs (e.g. **Gotchas**, **Protocol**, **Failure
modes**). Tone: specific, opinionated, no filler. No roadmaps, no phases.

### 4. Save

Write to `<outputDir>/<slug>.md` via the `Write` tool.

### 5. Report

One line:

```
→ <absolute-path>
```

## Guardrails — keep it about the idea

A sketch is **not** a plan. Do not include any of the following:

- File paths to be created or edited
- Function signatures or refactor steps
- Test plans, verification commands, gate criteria
- Rollback strategies
- Task lists, dependencies, sequencing, milestones
- Estimates, deadlines, owners

If the user's request includes these details, capture them as **Open
questions** ("Open: should `<thing>` be in `src/foo` or `src/bar`?") rather
than answering them. The plan skill answers them; the sketch records that
they exist.

Other rules:

- Don't pad. A 30-line sketch that says something beats a 200-line sketch
  that says nothing.
- Don't propose. Sketches frame; they don't commit.
- Don't overwrite silently. If the slug exists, suffix or ask.

## After the sketch

Suggest, in one line, whether the next move is `/plan <slug>` (if the
sketch is concrete enough to plan against) or another round of sketch
revision (if the open questions are still load-bearing).
