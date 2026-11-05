<h1 align="center">aleph</h1>

<p align="center">
  <b>A personal Claude Code plugin that remembers, guards each session, and builds its own issue list.</b>
</p>

<p align="center">
  <a href="https://github.com/crsmithdev/aleph/actions/workflows/ci.yml"><img src="https://github.com/crsmithdev/aleph/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=black" alt="Bun">
  <img src="https://img.shields.io/badge/Claude%20Code-2.1%2B-d97757" alt="Claude Code 2.1+">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/status-dark.png">
    <img alt="The aleph Status page: alerts that wait for you, lost time, completion, landed share, asks and usage, then agent time, stages, holds and the monitor's findings." src="docs/images/status-light.png" width="900">
  </picture>
</p>

Aleph sits under every Claude Code session. Hooks give the session its memory and trace each turn, and they stop the mistakes that cost the most later: an edit on `main`, a secret in a commit, a claim of "done" with no run behind it. Behind the sessions, a factory takes each open issue, writes a spec, builds it in a worktree, checks it, reviews it and lands it on `main`. It asks you only what it cannot decide.

It is one person's setup, built for one machine. Install it as it is, or fork it and take the parts you want.

## Features

- **Memory vault.** An Obsidian vault in its own git repo. Each session starts with `MEMORY.md` and the repo's core lines, and each prompt brings in up to 3 notes that bear on it. [Vault](docs/vault.md)
- **Verify gate.** A `Stop` hook blocks a final message that claims completion when no run after the last edit supports it. [Verify gate](docs/verify-gate.md)
- **Guards.** `main` takes no edits outside `.worktrees/`, a commit with a secret or a debug leftover is denied, and a `gh` write to another owner's repo asks first.
- **Context gate.** A warning as the context fills, and a handoff at the first compaction that the next session picks up by itself. [Context gate](docs/context-gate.md)
- **Tracing.** Each turn is one Langfuse trace with every tool call, subagent, model call and its cost. [Langfuse](docs/langfuse.md)
- **Issue store.** One list per repo in a private git repo, written only through `aleph issue`, with notes that are append-only. [Issues](docs/issues.md)
- **Factory.** Intake writes a spec with an Oracle, a worker builds it in a worktree, then checks, a keep-gate on new tests and a fresh reviewer decide before a land as one squash commit. Failures go back to the worker for a fix round. [Factory](docs/factory.md)
- **Director.** Each question the factory would ask goes first to a read-only agent that decides it or escalates it with a case. An Always rule turns a repeated answer into policy.
- **Model routing.** Jev reads each spec and gives the build Haiku, Sonnet or Opus, and the small tiers can move to a local `gpt-oss-20b` on the GPU.
- **Web UI.** Status, issues, jobs, efficiency, agents, sessions and memory, light and dark, on `127.0.0.1`. [UI](docs/ui.md)
- **Skills.** 23 skills for the work around code: grill a plan, red-team it, write the spec, TDD, diagnose a bug, review a branch, tidy a repo, write docs, hand off a session. Run one as `/aleph:<name>`.

## Quick start

Requires Claude Code 2.1 or later and [Bun](https://bun.sh).

```bash
git clone git@github.com:crsmithdev/aleph.git ~/aleph
cd ~/aleph && bun install
ln -s ~/aleph ~/.claude/skills/aleph                   # Claude Code loads it as aleph@skills-dir
ln -s ~/aleph/identity/CLAUDE.md ~/.claude/CLAUDE.md   # optional: the identity the hooks assume
ln -s ~/aleph/bin/aleph ~/aleph/bin/aleph-ui ~/.local/bin/
```

Start a Claude Code session in any repo. The `SessionStart` hooks inject the vault's memory and the factory report. Then:

```bash
/aleph:grill-me I want to move the cache from Redis to SQLite        # in the session

aleph issue add aleph "The Status page shows the wrong weekly usage" --priority high
aleph issue list aleph --status open
aleph-ui --port 3020                                                  # prints the URL
```

Without Langfuse keys the tracing hooks exit silently and everything else works. To turn on the factory for a repo, set `"sandbox": true` for it in `~/.aleph/repos.json` and start the timers in [Factory](docs/factory.md).

Edits to a `SKILL.md` apply at once. After you change a hook, run `/reload-plugins`. To try a checkout in one session only, run `claude --plugin-dir <path>`.

## Development

```bash
bun run test        # the suite, in parallel, with a mock Langfuse
bun run test:all    # the suite and the slow tests that start Chrome, as CI and the factory's checks run it
bunx tsc            # the type check
ALEPH_LIVE=1 bun test tests/live   # needs a running Langfuse and a logged-in claude
```

CI runs the type check and the suite on every push. The suite does not prove that Langfuse stores a trace: a 200 on the OTLP POST can still lose the batch. Only the live tests fetch the trace back.

Read [PRINCIPLES.md](PRINCIPLES.md) before a design, review or code change.
