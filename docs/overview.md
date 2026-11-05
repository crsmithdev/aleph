# Overview

Aleph is a Claude Code plugin for one person on one machine. It does two jobs.

1. **It shapes each Claude Code session.** Hooks start the session with memory, trace each turn to Langfuse, deny the edits and commits that are hard to undo, and block a claim of completion that no run supports. Skills give the session methods for planning, testing, review and writing.
2. **It runs a factory.** For each repo that opts in, the factory takes in the open issues, writes a spec for each one, builds it in a worktree, checks and reviews the branch, and lands it on `main`. It asks Chris only what a rule says it cannot decide.

[PRINCIPLES.md](../PRINCIPLES.md) holds the rules that decide design: solo use, the system decides what it can, every fact about a change is visible, and a gate stays only while its record shows faults it caught.

## Parts

| Part | Is | Code | Doc |
|---|---|---|---|
| Hooks | Scripts on Claude Code hook events | `hooks/` | [Hooks](hooks.md) |
| Skills | Methods a session runs as `/aleph:<name>` | `skills/` | Each `SKILL.md` |
| Vault | Notes that a session reads and writes, in an Obsidian vault | `vault/` | [Vault](vault.md) |
| Issue store | One issue list per repo, in a private git repo | `issues/` | [Issues](issues.md) |
| Factory | The `aleph` CLI and the processes that build issues | `jobs/` | [Factory](factory.md), [Workflow](workflow.md) |
| UI | `aleph-ui`: Status, issues, jobs, sessions, memory | `ui/` | [UI](ui.md), [Design](design.md) |
| Tracing | Self-hosted Langfuse | `compose/` | [Langfuse](langfuse.md) |
| Identity | The global `CLAUDE.md` and code style the hooks assume | `identity/` | |

## Stack

- TypeScript on [Bun](https://bun.sh): the runtime, the package manager and the test runner. No build step.
- Claude Code 2.1 or later, through `claude -p` on the subscription for every agent run.
- Jev on OpenRouter for cheap typed judgments: is this a claim of completion, does this note bear on the prompt, which model tier fits this spec.
- An optional local `gpt-oss-20b` under `llama-server`, or a model on OpenRouter, for the small tiers.
- git for the work store and the vault, JSON and JSONL files for the rest of the state, SQLite only for the vault's search index.
- systemd user units for the timers and the UI.
- The UI is plain ES modules and ECharts, served by `Bun.serve`.

## Words

| Word | Means |
|---|---|
| Issue | What someone asks for: Chris, a worker, the corrections or a session |
| Part | A goal that intake split from a large issue: `aleph-577.1` |
| Goal | An issue or part with a spec that the factory can build |
| Spec | Goal, Edit surface and Oracle: what to change, where, and the check that proves it |
| Job | All the runs on one goal, with one record |
| Run | One process: intake, a worker, a land, the director |
| Fix round | A send-back of a failed check or a review hold to the same worker branch |
| Land | The squash push of a passed branch onto `origin/main` |
| Ask | A decision the factory cannot make by itself |
| Director | The agent that decides an Ask or escalates it to Chris |
| Always rule | A standing answer for one Ask reason |
| Baseline | The last full-suite result on `origin/main` |

## Where to look next

- [Architecture](architecture.md): the processes, stores and flows.
- [Workflow](workflow.md): the path from issue to `main`, and every gate and send-back on it.
- [Data model](data-model.md): each file under `~/.aleph`.
- [Hooks](hooks.md): each hook and what it decides.
- [Routing](routing.md): which model does each piece of work.
