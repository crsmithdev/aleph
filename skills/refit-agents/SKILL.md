---
name: refit-agents
description: >
  Refit a repo for agents: lint and slim the files loaded into an agent's
  context (CLAUDE.md, AGENTS.md, skills, subagents, commands, hooks, MCP
  config), check skill structure and install scope, and find where an agent
  cannot build, test, run or use the repo's CLIs without help, or will not
  follow a line. Use when asked to improve, lint, audit, debloat or clean up
  agent files or skills, cut context load, run agnix, make a repo agent-ready,
  or when an agent had to guess how to use the repo. NOT for: writing one (use
  write-agents).
---

# Refit agents

[refit-code](../refit-code/SKILL.md) for agents. This skill asks whether an agent can use and change the repo without
help, and what the repo costs the agent's context. Nine **lenses** each ask one question. Follow
[refit/PROCESS.md](../refit/PROCESS.md) for the modes, the steps and the Act loop. This file holds what differs.

**Agent files** are every file an agent loads as instructions: `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`,
`.cursorrules`, `.github/copilot-instructions.md`, `llms.txt`, skills (`SKILL.md` and the files it links), subagents,
slash commands, `hooks.json` and settings hooks, `.mcp.json`, plugin manifests, and the output of hooks that inject
context.

## Lenses

| Lens | Asks | File |
|---|---|---|
| **valid** | Does each agent file parse and meet its spec? | [VALID.md](VALID.md) |
| **load** | Does each always-loaded line earn its tokens? | [LOAD.md](LOAD.md) |
| **structure** | Does each skill load in tiers, so that the agent reads only what its branch needs? | [STRUCTURE.md](STRUCTURE.md) |
| **triggers** | Does each description fire on its branches, and only there? | [TRIGGERS.md](TRIGGERS.md) |
| **drift** | Does each agent file agree with the code and with the other agent files? | [DRIFT.md](DRIFT.md) |
| **adherence** | Will the agent follow each line, every time, at the least cost? | [ADHERENCE.md](ADHERENCE.md) |
| **interface** | Can an agent build, test, run and use the repo with no one to ask? | [INTERFACE.md](INTERFACE.md) |
| **safety** | Can an agent file leak a secret, grant too much, or run code nobody reviewed? | [SAFETY.md](SAFETY.md) |
| **install** | Is each agent file installed once, at the scope that needs it, from its source? | [INSTALL.md](INSTALL.md) |

Where they meet:

- A file that does not parse is **valid**. A file that parses but costs too much is **load**.
- An always-loaded line is **load**. A skill body or reference that carries what its branch does not need is **structure**.
- A file under the home directory that copies the repo is **install**. A line in it that disagrees with the repo is **drift**.
- A description that is too long is **load**. One that fires on the wrong prompts is **triggers**.
- A line the agent can find by looking is **adherence** while it is right and **drift** once it is wrong.
- Two lines that contradict are **adherence** inside the agent files and **drift** against the code.
- A doc that restates `--help` is **load** while it is right and **drift** once it is wrong.
- A CLI with no usage text is **interface**. Prose that copies that usage is **drift**.
- A hook that fails open is **safety**. A hook that prints too much is **load**.

Report a candidate under one lens only.

## Modes

`scan`, `fix` and `fix <run dir>` of PROCESS.md. The scope is lens names. The report's unit is a loaded file
(CLAUDE.md, skill or hook).

## Find

1. **Inventory.** Run `bun <skill dir>/load.ts <repo>` for the context load (always, lazy, skills, hooks),
   `bun <skill dir>/content.ts <repo>` for the adherence candidates and the tools the files name,
   `bun <skill dir>/install.ts <repo>` from the main checkout for the user and project installs, and
   `agnix --format json .` from the repo root (the `tools` array in `.agnix.toml` names the target: `claude-code`,
   `cursor`, `codex` or `kiro`). List the repo's CLIs: `bin/`, the manifest's `bin` and `scripts`, the Makefile or
   justfile targets. Done when you have the load, install and agnix JSON and the CLI list.
2. **Hunt** by PROCESS.md. Read **valid** from the agnix JSON yourself, by [VALID.md](VALID.md). Each subagent gets
   the inventory and the agent files or CLIs in its scope. The Overview adds the always-loaded token total, the
   five largest always-loaded items and the agnix counts.

## Act order

valid, safety, install, drift, load, structure, triggers, adherence, then interface. Each file then has one source
before its text is edited, text is right before it is cut and cut before it is reworded, and code changes come
last. A cut moves material down the ladder of [write-agents](../write-agents/SKILL.md) before it deletes it. After
each finding, run agnix, `load.ts` and `content.ts` with the baseline. A new agnix error is red. The commit records
the always-loaded total before and after.


## Guards

The kinds are those of PROCESS.md.

| Lens | Guard | Kind | Tool |
|---|---|---|---|
| valid | An agent file that breaks its spec | tool | `agnix` with `tools = ["claude-code"]` in `.githooks/pre-commit` |
| load | Always-loaded tokens grow past the last total | tool | `load.test.ts`: "the always-loaded tokens inside the repo stay at or under the recorded total" |
| structure | A body over 500 lines, a reference more than one link deep | tool | agnix `AS-012`, `AS-013` in `.githooks/pre-commit` |
| structure | A body over 5,000 tokens | tool | `load.test.ts`: "no skill body inside the repo is over 5,000 tokens" |
| structure | An orphan, a chain from a reference | unchecked | none |
| triggers | Two descriptions that claim one branch | rule | write-agents RULES.md 4 |
| drift | A command, flag or path in an agent file that does not resolve | unchecked | a test that runs each named command |
| adherence | Emphasis, scaffolding, vague bars, unreasoned rules, dated text | unchecked | `content.ts` counts as a shrink-only ratchet, not yet wired |
| adherence | A contradiction, a discoverable fact, a hard rule left in prose | rule | write-agents RULES.md 6 |
| interface | A CLI command with no usage, or one whose `--help` runs it | unchecked | a test that runs `<cli> <cmd> --help` for each command and asserts no side effect |
| safety | A secret, an unpinned MCP server, a hook that fails open | unchecked | agnix security rules; a secret scan over agent files |
| install | A copy under the home directory, a shadow, a dangling link | unchecked | `install.ts` in the find step |

## Red flags

- **You added more lines to an always-loaded file than you removed, outside `interface`.** Use a pointer or the
  environment.
- **You copied a command's usage into a doc.** That is a cache: give the CLI a usage line instead, and point at it.
- **You ran an agnix `--fix` over the repo.** Revert it and read the diff.
- **You loosened a proof bar to keep a finding.** The finding goes. The bar stays.
