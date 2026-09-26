# aleph

A personal [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin. Fifteen skills for planning, design, testing and memory; hooks that trace every turn to a local [Langfuse](https://langfuse.com), guard `main`, scan commits for secrets and judge whether a turn verified what it claims; and an Obsidian vault the agent writes and a human reads.

Everything runs on [Bun](https://bun.sh). Langfuse is optional and self-hosted.

## Layout

| Path | Holds |
|---|---|
| `skills/` | the fifteen skills, invoked as `/aleph:<name>` |
| `hooks/` | the hook scripts and `hooks.json`, against the 2.1.x hook API |
| `vault/cli.ts` | the memory vault's mechanics: `init`, `write`, `adopt`, `recall`, `lint [--fix]`, `consolidate`, `rename-scope`, `archive`, `compile` |
| `identity/CLAUDE.md` | the global `CLAUDE.md` the hooks assume: the worktree rule, the verification rule, the voice |
| `compose/langfuse.yml` | self-hosted Langfuse on `127.0.0.1:3010` |
| `docs/` | the verify-gate decision record and the vault spec |
| `tests/live/` | tests against a running Langfuse and real headless sessions |

## Skills

| Skill | Does |
|---|---|
| `grill-me` | Interviews you about a plan until shared understanding. Maps the plan as a design tree and asks the whole open frontier each round, with a recommended answer per question |
| `grill-with-docs` † | `grill-me` that also writes `CONTEXT.md` and ADRs as terms and decisions settle |
| `red-team` | Parallel subagents review a plan, RFC or PR description against the code it touches; report by fatal, defects, smells, cheaper alternatives |
| `to-spec` | Turns the conversation into a spec file. No interview |
| `tdd` | Red → green, with tests only at seams agreed up front |
| `diagnosing-bugs` | Reproduce, minimise, rank several hypotheses, then fix |
| `codebase-design` | Vocabulary and principles for deep modules: module, interface, seam, adapter, the deletion test |
| `domain-modeling` | Builds the project glossary (`CONTEXT.md`) and records ADRs |
| `improve-codebase-architecture` † | Scans a codebase for deepening candidates, presents them as an HTML report, grills through the one you pick |
| `docs-writing` | Writes and audits docs with Diátaxis type gating and 51 rules |
| `writing-for-agents` | How to write a skill, an `AGENTS.md` or a `CLAUDE.md` |
| `vault` | Reads and writes the memory vault |
| `handoff` / `pickup` | Saves a session to `~/.aleph/handoffs/current.md`; resumes it in a fresh context |
| `retro` † | Reads the session's trace and transcript; proposes fixes to identity, skills, hooks and vault |

† user-invoked only: the model cannot fire it on its own.

## Hooks

| Event | Hook | Does |
|---|---|---|
| every event | `obs.ts` | posts one OTLP span per hook event to Langfuse; async except `Stop` and `SessionEnd` |
| `SessionStart` | `vault-context.ts` | injects the vault's `Home.md` and `MEMORY.md` |
| `UserPromptSubmit`, `Stop` | `verify-gate.ts` | snapshots the tree, then judges the final message: every claim of completion must trace to a run after the last edit. Denies with a reason, at most twice per prompt. `docs/verify-gate.md` |
| `PreToolUse` `Edit\|Write` | `git-guard.ts` | denies edits on `main` outside `.worktrees/`; allows the vault except `VAULT.md` |
| `PreToolUse` `Bash` | `secret-scan.ts` | denies a `git commit` whose added lines hold a secret or a debug leftover; `ALEPH_SKIP_SCAN=1` bypasses |

## Install

Requires Claude Code 2.1 or later and Bun.

```bash
git clone git@github.com:crsmithdev/aleph.git ~/aleph
cd ~/aleph && bun install
ln -s ~/aleph ~/.claude/skills/aleph                   # loads as aleph@skills-dir
ln -s ~/aleph/identity/CLAUDE.md ~/.claude/CLAUDE.md   # optional: the identity the hooks assume
```

`SKILL.md` edits are live. Hook changes need `/reload-plugins`. For a one-off session against a checkout: `claude --plugin-dir <path>`.

`identity/CLAUDE.md` is one person's working agreement. Fork it; the hooks only depend on the worktree rule and the verification rule.

## Langfuse

```bash
cp .env.example .env            # fill it; openssl rand -hex 32 for each secret
docker compose -p aleph-langfuse --env-file .env -f compose/langfuse.yml up -d
curl -s http://127.0.0.1:3010/api/public/health
```

The `LANGFUSE_INIT_*` block creates the org, project, user and API key pair on first boot. Put the pair where the hooks read it:

```
# ~/.aleph/.env
LANGFUSE_BASE_URL=http://127.0.0.1:3010
LANGFUSE_PUBLIC_KEY=pk-lf-…
LANGFUSE_SECRET_KEY=sk-lf-…
```

Without those two keys the observability hooks exit silently and the rest of the plugin works as before.

### Traces

One turn is one trace, and a session is the Langfuse session that groups them, so the Sessions page shows a session as its prompts and replies. Each trace is named after the session's starting directory and carries an `environment`: `interactive`, `headless` (an ancestor is `claude -p`) or whatever `ALEPH_ENV` says.

```
turn                    root: input = the prompt, output = the last assistant
│                       message, tags source:* and mode:*, metadata cwd
├─ <model id>           one generation per API request, usage and cost
├─ <tool name>          real start and end via a Pre→Post handshake file
├─ <agent type>         subagent, with its own tool spans beneath it
└─ verify-gate          guardrail: verdict and reason
```

Generations come from the transcript at `Stop`, one per `requestId`, with cache reads and cache writes as usage. The hook prices them from `hooks/lib/pricing.ts`, because Langfuse's models API keeps only input and output prices and cache reads are most of a Claude Code request.

A prompt that contains `N/10` puts a `rating` score of N on the previous turn's trace, with the prompt as the comment. The verify gate puts a `verified` score on every gated turn: 1 pass, 0 deny, 0.5 forced pass.

## Vault

Memory is an Obsidian vault at `~/.aleph/vault` (`ALEPH_VAULT` overrides), its own local git repo. The agent writes it; you read and correct it in Obsidian. Spec: `docs/specs/2026-09-04-memory-vault.md`.

```bash
bun vault/cli.ts init                                  # once
bun vault/cli.ts write "<Title>.md" --why "<one line>" # files by kind, logs to daily/, commits
bun vault/cli.ts recall "<query>"
bun vault/cli.ts lint
bun vault/cli.ts compile 2026-09-04                    # digest of a day's traces, handoffs and daily note
```

Notes are `wiki/<kind>/<Title>.md` with `[[Title]]` links and frontmatter `aliases kind scope confidence updated supersedes sources tags`. `write` refuses schema, duplicate, dangling-link, folder/kind, budget and template breaks, and warns on orphans, stale measured claims and same-scope overlap. `VAULT.md` is the human-owned contract. `compile` is the safety net for what the agent did not write on the day.

## Development

```bash
bun test                          # hooks and the vault CLI, with a mock Langfuse
ALEPH_LIVE=1 bun test tests/live  # posts a span and fetches the trace back; headless sessions through the vault
```

A 200 on the OTLP POST proves nothing, because the worker can drop a batch silently (`compose/README.md`). The live test asserts the trace is retrievable. CI runs the typecheck and the unit suite on every push.

## Credits

`tdd`, `diagnosing-bugs`, `retro`, `writing-for-agents`, `codebase-design`, `domain-modeling`, `grill-with-docs` and `improve-codebase-architecture` are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, `skills/LICENSE-mattpocock`). The first four drop its `CONTEXT.md`, ADR and issue-tracker conventions; the last four keep them, because those files are what the skills produce. `docs-writing` is adapted from [mblode/agent-skills](https://github.com/mblode/agent-skills) (MIT, `skills/LICENSE-mblode`), without its sibling-skill references and eval suite.
