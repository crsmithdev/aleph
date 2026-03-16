# construct-meta

Documentation and verification for the `/construct` command and its subcommands.

**Depends on:** construct-core

## Contents

- `README.md` — this file
- `INSTALL.md` — post-install checks for the `/construct` command

Note: the command file itself lives at `~/.claude/commands/construct.md`, outside any module directory. This module provides verification that it's correctly installed.

## Usage

All subcommands are run as `/construct <subcommand>` in Claude Code:

- `/construct install` — deploy modules globally from this repo to `~/.claude/`
- `/construct verify` — run post-install checks for all modules, reports pass/fail
- `/construct grasp` — have Claude surface its understanding of the active project before starting work
- `/construct status` — show system status: sessions, signals, memory stats
- `/construct retain` — review session summaries and promote durable insights to semantic memory
- `/construct trace` — toggle hook tracing on/off (makes hooks emit diagnostic output)
- `/construct trace CMD` — run a command with tracing temporarily enabled
- `/construct spec diff` — show documentation/code drift
- `/construct spec update` — update docs from current code state
- `/construct spec apply` — update code to match doc specs

## Verification

Post-install checks: see [INSTALL.md](INSTALL.md).
