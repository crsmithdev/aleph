# aleph-next

A design for Aleph: a personal agent that runs on your machine, answers on
Telegram, remembers things, and writes code with the Claude Code CLI.

**This repository holds no code today.** It holds the design, and the design is
not built.

| | |
|---|---|
| [`docs/design/aleph.md`](docs/design/aleph.md) | the design |
| `docs/design/aleph.html` | the same design as a page |
| `docs/design/aleph-shapes.html` | the comparison that selected this shape |

## What it is

The daemon owns the conversation: its own agent loop, its own tools, its own
transcript. `claude` is not the runtime — it is what the daemon reaches for when
the work is code.

Chat tokens are metered on an API, and they are small. Coding tokens run on the
CLI against a subscription, and they are large. That split is the reason for
this shape.

Six workflows are the full test of it: one local session, many local sessions,
one mobile session, many mobile sessions, and the two handovers between a desk
and a telephone.

## History

An earlier implementation — a Bun daemon with an event log, Telegram and CLI
channels, an Obsidian vault and OTel export — is in the git history at
`dca908d`. It is not in the working tree.

Predecessor: [`crsmithdev/aleph`](https://github.com/crsmithdev/aleph).
