# Routing

This page states which model or command does each piece of work, with which tools, where, and for how long. Every agent role is `claude -p` on the Claude subscription, except the judge's first pass, which is Jev on OpenRouter. A local `gpt-oss-20b` or a model on OpenRouter can take some tiers.

## Roles

| Role | Model | Tools | Runs in | Time box | Output |
|---|---|---|---|---|---|
| Intake | `claude-opus-5-5` | Read, Grep, Glob | A temp clone of `origin/main` | 900 s | `INTAKE_SCHEMA`: a route |
| Worker | The routed tier, else the CLI default | Read, Write, Edit, Bash, Grep, Glob | `<repo>/.worktrees/job-<name>` | `ALEPH_JOB_TIMEOUT` (1800 s) | `WORKER_SCHEMA` |
| Merge worker | `haiku`, or the local `merge` tier | As the worker | As the worker | 600 s | `WORKER_SCHEMA` |
| Reviewer | `claude-opus-5-5` | Read, Grep, Glob, Bash | A detached worktree at the branch tip | `ALEPH_REVIEW_TIMEOUT` (600 s) | `REVIEW_SCHEMA`: `pass` or `hold` |
| Director | `claude-opus-5-5` | Read, Grep, Glob; read-only `git`, `ls`, `aleph jobs`, `aleph issue show\|list` | The repo's main checkout, plus the vault's decisions | 900 s | `DIRECTOR_SCHEMA`: actions and case text |
| Monitor | `deepseek-v4.1-flash` | None | | 600 s | Numbered findings |
| Title and rule writer | `haiku`, or the local `title` tier | None, 1 turn | | 30 s | One line |
| Judge | Jev, then `haiku` or the local `judge` tier | None, 1 turn | | 30 s | `{verdict, reason}` |

The code: intake `jobs/lib/roles/intake.ts`, worker and reviewer `jobs/lib/roles/unit.ts`, director `jobs/lib/roles/director.ts`, monitor `jobs/lib/roles/monitor.ts`, titles `jobs/lib/roles/title.ts`, judge `hooks/lib/judge.ts`.

Corrections, episodes and the firefighter start no agent. Corrections asks Jev typed questions; episodes read git, the ledger and Langfuse; the firefighter is code.

## How a run starts

`openRun` and `callAgent` in `jobs/lib/roles/agent-run.ts` start each one-reply role:

```bash
claude -p --strict-mcp-config --disable-slash-commands \
  --output-format stream-json --verbose --model <model> <role flags> [--json-schema <schema>]
```

- The environment drops `ANTHROPIC_API_KEY` and `CLAUDECODE`, so each run uses the subscription.
- The time box sends SIGTERM, then SIGKILL after 30 seconds, to the process group.
- `askAgain` resumes the same session with `--resume` for a send-back, such as intake's second try.
- `jobs/lib/roles/structured.ts` reads `structured_output` from the stream's `result` event.
- The worker and reviewer go through `agentCall`, which adds the stall watch (`ALEPH_STALL_SECONDS`, 600).

The worker's environment (`agentEnv`) rewrites a push to `git@github.com:` to a dead remote, gives `gh` a private config with no token, and sets `ALEPH_JOB_ID` and `ALEPH_JOB_RUN`.

`jobs/lib/transitions/launch.ts` starts `aleph intake`, `dispatch`, `director` and `suite` as transient systemd units (`systemd-run --user`). `ALEPH_JOB_FOREGROUND=1` runs them as child processes. `ALEPH_DISPATCH`, else `on`; `ALEPH_DISPATCH=off` stops all of them.

## Skills in roles

Every role runs with `--disable-slash-commands`, so it loads no skill. The worker gets `skills/code-change/SKILL.md` and the reviewer gets `skills/code-review/SKILL.md` as a section of the prompt (`jobs/lib/roles/role-skill.ts` `skillSection`). The other roles get no skill.

## Worker tiers

`route(spec)` in `jobs/lib/routing/route.ts` asks Jev one `choice` question about the goal's spec:

| Tier | Model | Fits |
|---|---|---|
| `worker-low` | `haiku` | A small, mechanical change in one or two files whose done state is exact |
| `worker-medium` | `sonnet` | A typical change across several files, with a clear Oracle |
| `opus` | `opus` | A design-heavy or cross-cutting change, or one whose approach is open |

Jev's answer counts when its probability is at least 0.6. Otherwise, or when Jev fails or the judge choice is `haiku`, the run gets no `--model` and uses the CLI default. A disabled tier steps up to the next enabled one; `opus` is always on.

The dispatch also routes when the live cap holds a goal: if a tier on the local model has room, the goal starts there.

## Models other than Claude's

`MODELS` in `jobs/lib/routing/models.ts` lists every model a tier can use. Each row names who serves it (`claude`, `local` or `openrouter`), the id passed to `--model`, and, for a model Claude does not serve, its price per million tokens. Every call is `claude -p`, built by `modelArgv()`; a model Claude does not serve differs only in the env `modelEnv()` adds. To add a model, add a row.

| Model | Served by | Id |
|---|---|---|
| `haiku`, `sonnet` | Claude, on the subscription | `haiku`, `sonnet` |
| `gpt-oss-20b` | `llama-server` on `127.0.0.1:8012` | `gpt-oss-20b` |
| `deepseek-v4.1-flash` | OpenRouter | `deepseek/deepseek-v4.1-flash` |
| `gpt-6-luna` | OpenRouter | `openai/gpt-6-luna` |
| `minimax-m3.1-flash` | OpenRouter | `minimax/minimax-m3.1-flash` |
| `step-3.5-flash` | OpenRouter | `stepfun/step-3.5-flash` |
| `mimo-v2.6-flash` | OpenRouter | `xiaomi/mimo-v2.6-flash` |

`~/.aleph/factory/models.json` maps each tier to `{enabled, model}`. Each tier offers its Claude model first, then every model Claude does not serve:

| Tier | Claude model |
|---|---|
| `worker-low` | `haiku` |
| `worker-medium` | `sonnet` |
| `merge` | `haiku` |
| `title` | `haiku` |
| `judge` | `haiku` |

```bash
aleph models                          # show the tiers
aleph models set worker-low deepseek-v4.1-flash
aleph models disable worker-medium    # only the worker tiers can be off
```

A run on a worker tier set to another model records that model as `model` and its Claude model as `tier`. Claude Code knows Claude's prices only, so such a run's cost is its tokens times the row's price (`costDetails()` in `hooks/lib/pricing.ts`), not `total_cost_usd`. The Agents page offers the same models and disables one whose backend is down.

**OpenRouter.** A call gets `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `OPENROUTER_API_KEY` as `ANTHROPIC_AUTH_TOKEN` (from the environment or `~/.aleph/.env`), an empty `ANTHROPIC_API_KEY`, and the model's id in the default-model variables. OpenRouter runs count against the live cap and take no GPU slot. Without a key, the Agents page disables the OpenRouter models.

**Local.** `llama-server` is run by `jobs/systemd/aleph-gpt-oss.service` through `jobs/lib/routing/gpt-oss-start.ts`, which sets the CPU offload from the free VRAM. A call on it gets `ANTHROPIC_BASE_URL` pointed at the server, a 40,960-token window and 4,096 output tokens. One GPU means one local run at a time: `LOCAL_CAP` is 1 and the `gpu` lock holds the rest. Local runs do not count against the live cap. A title or judge call that cannot get the GPU in time falls back to Claude Haiku. The measurements are in [the gpt-oss finding](findings/2026-11-04-gpt-oss-20b-llama-server.md).

## Judge

`judgeChoice()` reads `ALEPH_JUDGE` first. If it is not set, `judgeChoice()` reads the file `~/.aleph/judge`. If neither is set, the default is `ALEPH_JUDGE`, else `jev`. `aleph judge [jev|haiku]` sets it.

- **Jev** is `typesafe/jev-1.13` through OpenRouter's decisions endpoint (`hooks/lib/jev.ts`), with `OPENROUTER_API_KEY`. It answers typed questions only: `choice` or `noul` (a probability). It never denies a turn.
- **Haiku** is `claude -p --model haiku --setting-sources "" --max-turns 1 --tools ""` with a rubric as the system prompt, up to 2 tries.

| User | With `jev` | With `haiku` |
|---|---|---|
| Verify gate | Jev scores whether the final message claims completion; under 0.05 passes, else Haiku decides | Haiku decides |
| Vault recall | Jev scores each candidate note | Off |
| Task type on traces | Jev tags each turn | Off |
| Worker tier | Jev picks the tier | No `--model` |
| Corrections | Jev groups signals into lessons | Jev, the same |

A judge that cannot answer passes the turn (fail open).

## Intake routes

Intake routes an issue, not a model. Code decides first: a `flake` issue becomes a tracker note, and an issue named in an `Issue:` trailer on main is done. Otherwise the Opus run returns `build`, `close`, `done` or `ask`. [Workflow](workflow.md#1-intake) has the checks on each route.

## Overrides

| Replaces | Variable |
|---|---|
| The worker command, `claude` | `ALEPH_WORKER_CMD` |
| The reviewer command, the worker command | `ALEPH_REVIEWER_CMD` |
| The command and time box for `INTAKE`, `DIRECTOR`, `MONITOR` | `ALEPH_<ROLE>_CMD`, `ALEPH_<ROLE>_TIMEOUT` |
| The judge's Haiku command | `ALEPH_JUDGE_CMD` |
| The title and rule writer's command | `ALEPH_RULE_CMD` |
| The Jev endpoint | `ALEPH_JEV_URL` |

Tests use these to put in a fake.
