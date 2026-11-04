# aleph

A personal [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin. It adds skills, hooks that guard and trace each session, a memory vault, an issue store, and a factory that builds issues and lands them on `main`.

It is one person's setup. You can install it as it is, or fork it and take the parts you want.

## Install

Requires Claude Code 2.1 or later and [Bun](https://bun.sh).

```bash
git clone git@github.com:crsmithdev/aleph.git ~/aleph
cd ~/aleph && bun install
ln -s ~/aleph ~/.claude/skills/aleph                   # Claude Code loads it as aleph@skills-dir
ln -s ~/aleph/identity/CLAUDE.md ~/.claude/CLAUDE.md   # optional: the identity the hooks assume
ln -s ~/aleph/bin/aleph ~/aleph/bin/aleph-ui ~/.local/bin/
```

Edits to a `SKILL.md` apply at once. After you change a hook, run `/reload-plugins`. To try a checkout in one session only, run `claude --plugin-dir <path>`.

## Quick start

1. Start a Claude Code session in any repo. The `SessionStart` hooks inject the vault's `Home.md` and `MEMORY.md`, and the factory report.
2. Run a skill, for example a grill on a plan:
   ```text
   /aleph:grill-me I want to move the cache from Redis to SQLite
   ```
3. File an issue and list the repo's issues:
   ```bash
   aleph issue add aleph "The Status page shows the wrong weekly usage" --priority high
   aleph issue list aleph --status open
   ```
4. Open the factory UI:
   ```bash
   aleph-ui --port 3020   # prints the URL; bound to 127.0.0.1
   ```

Without Langfuse keys the tracing hooks exit silently and everything else works. To add tracing, see [Langfuse](docs/langfuse.md).

## What each part does

### Skills

Invoke a skill as `/aleph:<name>`. Claude can also start one by itself, except the three marked †.

| Skill | Does |
|---|---|
| `grill-me` | Interviews you about a plan until you both understand it, with a recommended answer per question |
| `grill-with-docs` † | `grill-me` that also writes `GLOSSARY.md` and ADRs as terms and decisions settle |
| `red-team` | Parallel subagents check a plan, RFC or PR description against the code and rank its flaws |
| `prior-art` | Surveys open-source projects that solve the same problem and ranks what to take or skip |
| `to-spec` | Turns the conversation into a spec file |
| `goal` | A short grill that files one issue with its spec for the factory |
| `tdd` | Red, then green, with tests only at agreed seams |
| `diagnosing-bugs` | Reproduce, minimise, rank hypotheses, then fix |
| `codebase-design` | Vocabulary for deep modules: module, interface, seam, adapter |
| `code-change` | The smallest diff that meets the goal, each line traced to it, each step proved by a run |
| `code-review` | Judge a finished branch against its goal: verdict per requirement, test-cheating catalog, a bar for findings |
| `spec-review` | Check a spec before a builder starts: guesses, conflicts, unobservable clauses, each with a rewrite |
| `design-language` | Extract a UI's design language into docs/design.md, or audit the UI against it; ships an inventory script |
| `domain-modeling` | Builds the glossary (`GLOSSARY.md`) and records ADRs |
| `improve-codebase-architecture` † | Finds deepening candidates, reports them as HTML, grills the one you pick |
| `tidy` | Removes junk and dead code behind a green build, and checks a repo is ready to show |
| `docs-writing` | Writes and audits docs with Diátaxis type gating |
| `humanizer` | Rewrites prose so it does not read as written by AI |
| `writing-for-agents` | How to write a skill, an `AGENTS.md` or a `CLAUDE.md` |
| `vault` | Reads and writes the memory vault |
| `handoff` / `pickup` | Saves a session to `~/.aleph/handoffs/` and resumes it in a fresh context |
| `retro` † | Reads a session's trace and transcript and proposes fixes to identity, skills, hooks and vault |

### Hooks

`hooks/hooks.json` registers these against the Claude Code 2.1 hook API.

| Event | Hook | Does |
|---|---|---|
| every event | `obs.ts` | Sends one span per event to Langfuse |
| `SessionStart` | `vault-context.ts` | Injects the vault's `Home.md` and `MEMORY.md` |
| `SessionStart` | `aleph report --hook` | Injects new factory runs, how far each checkout is behind `origin/main`, and health lines |
| `UserPromptSubmit` | `vault-recall.ts` | Injects up to 3 vault notes that bear on the prompt |
| `UserPromptSubmit`, `Stop` | `verify-gate.ts` | Blocks a final message that claims completion without a run after the last edit ([verify gate](docs/verify-gate.md)) |
| `Stop` | `context-gate.ts` | Warns when the context fills, and asks for a handoff after a compaction ([context gate](docs/context-gate.md)) |
| `PreToolUse` `Edit\|Write\|NotebookEdit` | `git-guard.ts` | Denies edits on `main` outside `.worktrees/` |
| `PreToolUse` `Bash` | `secret-scan.ts` | Denies a `git commit` that adds a secret or a debug leftover; `ALEPH_SKIP_SCAN=1` skips it |

### Vault

The memory vault is an Obsidian vault at `~/.aleph/vault`, in its own git repo. The agent writes it and you read it in Obsidian.

```bash
bun vault/cli.ts recall "verify gate"
bun vault/cli.ts write "My Note.md" --why "what changed"
```

See [Vault](docs/vault.md).

### Issues

Every repo in `~/.aleph/repos.json` has an issue list in the work store, a git repo at `~/.aleph/issues`. `aleph issue` is the only writer.

```bash
aleph issue show aleph 1057
aleph issue note aleph 1057 "Reproduced on main at c26c10f"
```

See [Issues](docs/issues.md).

### Factory

A repo with `"sandbox": true` in `~/.aleph/repos.json` is a factory repo. The factory takes in its open issues, starts a worker for each ready goal, checks and reviews the branch, and lands it on `main`.

```bash
aleph dispatch       # start every ready goal, up to the caps
aleph status         # the state of each open issue
aleph pause          # start no new run; aleph resume undoes it
```

See [Factory](docs/factory.md) and [Factory tasks](docs/factory-tasks.md).

### UI

`aleph-ui` serves the Status page, issues, jobs, sessions, skills and memory on `127.0.0.1:3020`. See [UI](docs/ui.md).

## Layout

| Path | Holds |
|---|---|
| `skills/` | The skills |
| `hooks/` | The hook scripts and `hooks.json` |
| `jobs/` | The `aleph` CLI, the issue store client, the factory, and its systemd and Windows startup files |
| `vault/cli.ts` | The memory vault's commands |
| `ui/` | `aleph-ui`: the server, `ui/api/*.ts` routes and `ui/views/*.js` pages |
| `identity/CLAUDE.md` | The global `CLAUDE.md` the hooks assume |
| `compose/langfuse.yml` | Self-hosted Langfuse on `127.0.0.1:3010` |
| `docs/` | Reference pages, decision records, specs and findings |
| `tests/live/` | Tests against a running Langfuse and real headless sessions |

## Development

```bash
bun run test        # the suite, in parallel, with a mock Langfuse
bun run test:all    # the suite and the slow tests that start Chrome, as CI and the factory's checks run it
bunx tsc            # the type check
ALEPH_LIVE=1 bun test tests/live   # needs a running Langfuse and a logged-in claude
```

CI runs the type check and the suite on every push. The suite does not prove that Langfuse stores a trace: a 200 on the OTLP POST can still lose the batch. Only the live tests fetch the trace back.

## Credits

`tdd`, `diagnosing-bugs`, `retro`, `writing-for-agents`, `codebase-design`, `domain-modeling`, `grill-with-docs` and `improve-codebase-architecture` are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, `skills/LICENSE-mattpocock`). `docs-writing` is adapted from [mblode/agent-skills](https://github.com/mblode/agent-skills) (MIT, `skills/LICENSE-mblode`). `code-change` is adapted from [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT per its skill frontmatter; the repo has no license file) and `codebase-design`. `code-review` and `spec-review` adapt rules from [openai/codex](https://github.com/openai/codex) (Apache-2.0), [garrytan/gstack](https://github.com/garrytan/gstack), [obra/superpowers](https://github.com/obra/superpowers), [github/spec-kit](https://github.com/github/spec-kit), [gotalab/cc-sdd](https://github.com/gotalab/cc-sdd) and [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) (MIT), and take ideas, not text, from [trailofbits/skills](https://github.com/trailofbits/skills) (CC-BY-SA-4.0); each SKILL.md names the commits. `humanizer` is [blader/humanizer](https://github.com/blader/humanizer) 3.1.0 at `8c307f3`, unmodified (MIT, `skills/LICENSE-humanizer`).
