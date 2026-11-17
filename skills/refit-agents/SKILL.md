---
name: refit-agents
description: >
  Refit a repo for agents: lint and slim the files loaded into an agent's
  context (CLAUDE.md, AGENTS.md, skills, subagents, commands, hooks, MCP
  config), check skill structure and install scope, and find where an agent
  cannot build, test, run or use the repo's CLIs without help, or will not
  follow a line. Use when asked to improve, lint, audit, debloat or clean up
  agent files or skills, cut context load, run agnix, make a repo agent-ready,
  before you add a skill, a CLAUDE.md line or a CLI command (check), or when
  an agent had to guess how to use the repo. NOT for: writing one (use
  write-agents).
---

# Refit agents

[refit-code](../refit-code/SKILL.md) for agents. This skill asks whether an agent can use and change the repo without
help, and what the repo costs the agent's context. Nine **lenses** each ask one question. The modes decide where and
how they run. Read `PRINCIPLES.md` and `.refit.json` at the repo root when they exist. Its `accepted` list, shared
with refit-code, holds what the repo keeps on purpose.

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

| Mode | Runs | Reach for it |
|---|---|---|
| `retro [lens ...]` (default: all) | Baseline, inventory, hunt, prove, fix and guard, report | Find what to improve and fix the auto findings |
| `scan [lens ...]` | The retro without the fix | Find what to improve, change nothing |
| `act` | The fix of each ask finding Chris approves | After a retro |
| `lint` | agnix, `load.ts`, `content.ts` and `install.ts` only, no model judgment, report in the terminal | A quick pass, or before a commit that touches agent files |
| `check` | Each new agent file, line, skill, hook or CLI command in a plan, spec or diff, under every lens | Before or during a build |

## Retro

1. **Baseline.** Run the repo's own build and test commands from its manifest. A red baseline ends the run.
   Record the commit and `git status --porcelain`. Done when the baseline is green and recorded.
2. **Inventory.** Run `bun <skill dir>/load.ts <repo>` for the context load (always, lazy, skills, hooks),
   `bun <skill dir>/content.ts <repo>` for the adherence candidates and the tools the files name,
   `bun <skill dir>/install.ts <repo>` from the main checkout for the user and project installs, and
   `agnix --format json .` from the repo root (the `tools` array in `.agnix.toml` names the target: `claude-code`,
   `cursor`, `codex` or `kiro`). List the repo's CLIs: `bin/`, the manifest's `bin` and `scripts`, the Makefile or
   justfile targets. Done when you have the load, install and agnix JSON and the CLI list.
3. **Hunt.** Spawn one Explore subagent per lens in one message, except **valid**, which you read from the agnix
   JSON yourself. Give each its lens file's Signals section verbatim, the inventory, and the agent files or CLIs
   in its scope. Each returns candidates as: lens, file and line, the signal that found it. Done when each
   subagent has returned.
4. **Prove, fix and guard, report.** Follow refit-code's [PROVE.md](../refit-code/PROVE.md) with this skill's lens
   files and `.refit.json`. The Overview adds the always-loaded token total and the agnix counts. Done when PROVE.md's
   step 3 is done.

## Act

refit-code's [Act](../refit-code/SKILL.md#act), in this order: valid, safety, install, drift, load, structure,
triggers, adherence, then interface. Each file then has one source before its text is edited, text is right before
it is cut and cut before it is reworded, and code changes come last. A cut moves material down the ladder of
[write-agents](../write-agents/SKILL.md) before it deletes it. After each finding, run agnix, `load.ts` and
`content.ts` with the baseline. A new agnix error is red. The commit records the always-loaded total before and after.

## Lint

1. Run agnix, `load.ts`, `content.ts` and `install.ts` as in Inventory.
2. Read each agnix error and warning by hand, with [VALID.md](VALID.md). Never run `--fix`, `--fix-safe` or
   `--fix-unsafe` over the whole repo: XML-001 reads a bare `<placeholder>` in prose as an unclosed tag, and its
   fix adds a closing tag. Fix by hand, or run `--fix` on one file after `--dry-run --show-fixes`. Read `PE-003`
   and `CC-MEM-007` by the policy in [ADHERENCE.md](ADHERENCE.md).
3. Report in the terminal: agnix counts before and after, each finding with `file:line` and its fix, the
   always-loaded total, the five largest always-loaded items, the `content.ts` counts with the five files that
   have most hits, the tools the files name for the user to confirm, and each `copies`, `shadow` and `dangling`
   entry from `install.ts`.

## Check

1. **List the new things.** From the plan, spec or diff: each new agent file, CLAUDE.md or AGENTS.md line, skill,
   description, subagent, command, hook, MCP server, and CLI command or flag.
2. **Ask each lens's Check question** of each item. Record the answer and the search behind it.
3. **Judge.** Each item gets one verdict: **keep**, **move** (name where on the ladder), **merge** (name the
   file that already says it), **cut** (no branch needs it), or **fix** (name the lens and the change). Done
   when every item has a verdict.

## Guards

A guard keeps a fixed finding fixed. Each one has a kind: **tool** (a hook or test runs it), **model** (`check`
asks it) or **unchecked** (only a retro finds it). A finding that comes back moves up a kind.

| Lens | Guard | Kind | Tool |
|---|---|---|---|
| valid | An agent file that breaks its spec | tool | `agnix` with `tools = ["claude-code"]` in `.githooks/pre-commit` |
| load | Always-loaded tokens grow past the last total | tool | `load.test.ts`: "the always-loaded tokens inside the repo stay at or under the recorded total" |
| structure | A body over 500 lines, a reference more than one link deep | tool | agnix `AS-012`, `AS-013` in `.githooks/pre-commit` |
| structure | A body over 5,000 tokens | tool | `load.test.ts`: "no skill body inside the repo is over 5,000 tokens" |
| structure | An orphan, a chain from a reference | unchecked | none |
| triggers | Two descriptions that claim one branch | model | `check` |
| drift | A command, flag or path in an agent file that does not resolve | unchecked | `aleph doc-claims` in aleph; elsewhere a test that runs each named command |
| adherence | Emphasis, scaffolding, vague bars, unreasoned rules, dated text | unchecked | `content.ts` counts as a shrink-only ratchet, not yet wired |
| adherence | A contradiction, a discoverable fact, a hard rule left in prose | model | `check` |
| interface | A CLI command with no usage, or one whose `--help` runs it | unchecked | a test that runs `<cli> <cmd> --help` for each command and asserts no side effect |
| safety | A secret, an unpinned MCP server, a hook that fails open | unchecked | agnix security rules; a secret scan over agent files |
| install | A copy under the home directory, a shadow, a dangling link | unchecked | `install.ts` in `lint`, by hand |

## Red flags

- **You added more lines to an always-loaded file than you removed, outside `interface`.** Use a pointer or the
  environment.
- **You copied a command's usage into a doc.** That is a cache: give the CLI a usage line instead, and point at it.
- **You ran an agnix `--fix` over the repo.** Revert it and read the diff.
- **You loosened a proof bar to keep a finding.** The finding goes. The bar stays.
