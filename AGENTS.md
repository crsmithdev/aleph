# aleph-next — agent entry point

This repository holds a design. It holds no code.

Read `docs/design/aleph.md` first. That file is the specification, and
everything else here supports it.

## What is here

| Path | What it is |
|---|---|
| `docs/design/aleph.md` | the design |
| `docs/design/aleph.html` | the same design as a page |
| `docs/design/aleph-shapes.html` | the comparison that selected this shape |

## What was here

An earlier implementation is in the history at `dca908d`: a Bun daemon with an
event log, Telegram and CLI channels, an Obsidian vault, and OTel export to
Langfuse. Nothing in the working tree depends on it.

To read it:

```bash
git show dca908d:src/core/emit.ts
git checkout dca908d -- src/          # if you want it back
```

§12 of the design names the parts to take from it when code starts again.

## The rule that matters

**Never say that something operates correctly before you run it and see the
output.**

The design obeys the same rule about itself. Nothing in it is built, and each
workflow in §2 is a target.

## Style

The design obeys ASD-STE100 Simplified Technical English. Keep it that way:
short sentences, the active voice, and one meaning for each word.

## When code starts again

Read §10 for the milestones and §12 for the parts to take from the history. M0
is the loop, `aleph chat`, memory, the skill index and the event log.

Do not add a build, a test runner or a CI workflow before there is code for them
to serve.
