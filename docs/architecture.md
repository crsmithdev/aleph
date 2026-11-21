# Architecture

## System context

```mermaid
flowchart TB
  Chris((Chris))
  subgraph Host["WSL2 host"]
    CC[Claude Code session]
    Hooks[aleph hooks]
    CLI[aleph CLI]
    Factory[Factory processes<br/>systemd units]
    UI[aleph-ui<br/>127.0.0.1:3020]
    Stores[(~/.aleph<br/>issues, jobs, runs,<br/>factory, vault)]
    LF[(Langfuse<br/>127.0.0.1:3010)]
    Llama[llama-server<br/>gpt-oss-20b]
  end
  GH[(GitHub<br/>origin/main)]
  Jev[Jev on OpenRouter]
  Claude[Claude subscription]

  Chris --> CC
  Chris --> UI
  CC <--> Hooks
  Hooks --> LF
  Hooks --> Stores
  Hooks --> Jev
  CC --> CLI
  UI --> CLI
  CLI --> Stores
  CLI --> Factory
  Factory --> Claude
  Factory --> Llama
  Factory --> Jev
  Factory --> GH
  Factory --> Stores
  UI --> Stores
  UI --> LF
```

Chris works in Claude Code sessions and on the UI. Both write through the `aleph` CLI. The factory reads and writes the stores, starts `claude -p` runs and pushes to GitHub. Nothing listens on a public interface.

## Processes

| Process | Started by | Lives | Code |
|---|---|---|---|
| Hooks | Claude Code, per event | One event | `hooks/*.ts` |
| `aleph` CLI | Chris, a session, the UI | One command | `cli/cli.ts` |
| `aleph tick` | `aleph-tick.timer`, each minute | Seconds | `jobs/lib/transitions/tick.ts` |
| `aleph suite` | `aleph-suite.timer`, hourly | Minutes | `jobs/lib/transitions/baseline.ts` `suiteStep` |
| Dispatch, intake, director | A transition, as a transient systemd unit | Until done | `jobs/lib/transitions/launch.ts` |
| Unit: worker, verify, review, land | A dispatch | Up to the time boxes | `jobs/lib/roles/unit.ts` |
| `aleph-ui` | `aleph-ui.service` | Always | `ui/server.ts` |
| `llama-server` | `aleph-gpt-oss.service` | Always, optional | `jobs/lib/routing/gpt-oss-start.ts` |

The unit files are in `jobs/systemd/`. [Start at boot](start-at-boot.md) starts WSL and the units after a Windows restart.

## Building blocks

| Folder | Holds |
|---|---|
| `hooks/` | One script per hook; `hooks/lib/` has the secret rules and the snapshots |
| `skills/` | One folder per skill with its `SKILL.md`; the licences of adapted skills |
| `vault/` | `vault/lib/`, run by `aleph memory`: notes, the FTS index, git |
| `cli/` | `cli/cli.ts` (the `aleph` entry) and `cli/commands.ts` (the command table) |
| `issues/` | `issues/lib/issues.ts` (the `aleph issue` verbs) over the items repo; `issues/cli.ts` parses and prints `aleph issue` |
| `jobs/` | `jobs/lib/`: the factory; `jobs/systemd/` and `jobs/windows/` start it |
| `ui/` | `ui/server.ts`; `ui/api/*.ts` routes, loaded by file name; `ui/views/*.js` pages; `ui/state.ts` builds the Status state in a worker thread |
| `lib/` | Shared modules across subsystems: `naming.ts`, `env.ts`, `jev.ts`, `otlp.ts`, `pricing.ts`, `refusal.ts`, `frontmatter.ts`; the items repo: `store.ts` (git I/O), `issue-file.ts` (file format), `issue-spec.ts` (spec sections), `projects.ts` (the registry's files) |
| `identity/` | The global `CLAUDE.md` and `VOICE.md` |
| `compose/` | Langfuse in Docker |
| `tests/` | Repo-wide tests, `tests/live/` against real services |

The modules of `jobs/lib/`, one folder per concern:

| Concern | Folder | Modules |
|---|---|---|
| Records and runs | `records/` | `record.ts`, `ledger.ts`, `job.ts`, `run-files.ts`, `outcome.ts`, `stage.ts`, `status.ts`, `jobdiff.ts` |
| Transitions | `transitions/` | `transitions.ts`, `continuation.ts`, `factory.ts`, `dispatch.ts`, `sweep.ts`, `baseline.ts`, `stall.ts`, `report.ts`, `tick.ts`, `launch.ts` |
| Agent roles | `roles/` | `agent-call.ts`, `agent-run.ts`, `intake.ts`, `unit.ts`, `director.ts`, `monitor.ts`, `title.ts`, `role-skill.ts` |
| Gates and checks | `gates/` | `issue-decision.ts`, `factory-status.ts`, `holds.ts`, `pause.ts`, `gpu.ts`, `tables.ts`, `checks.ts`, `gate.ts`, `worker-verdict.ts`, `ci.ts`, `firefighter.ts`, `smoke.ts`, `related.ts` |
| Land and recovery | `land/` | `landing.ts`, `rescue.ts` |
| Routing | `routing/` | `route.ts`, `models.ts`, `gpt-oss-start.ts` |
| Asks | `asks/` | `ask.ts`; the director (`jobs/lib/roles/director.ts`) answers the asks |
| Learning | `learning/` | `monitor-table.ts`, `trace.ts` |
| Infrastructure | `infra/` | `git.ts`, `process.ts`, `clock.ts`, `settings.ts`, `main-clone.ts`, `ui-graph.ts`, `doctor.ts`, `systemd.ts` |

The tests, fixtures and testkits of a module are in its folder.

## Key flows

### A session turn

1. `SessionStart`: `vault-context` injects memory, `handoff-start` offers a handoff, `aleph report --hook` injects the factory report.
2. `UserPromptSubmit`: `verify-gate` snapshots the repo; `vault-recall` injects notes.
3. `PreToolUse`: `git-guard`, `secret-scan`, `gh-guard` and `bash-allow` allow, deny or ask.
4. `Stop`: `verify-gate` compares against the snapshot and may block; `context-gate` may warn or ask for a handoff.
5. Every event: `obs.ts` adds a span to the turn's trace.

[Hooks](hooks.md) has each step.

### An issue to main

`aleph issue add` writes the store and starts intake. Intake writes the spec and starts a dispatch. The dispatch asks the gates and starts a unit. The unit runs the worker, Verify and the reviewer, then lands. Each run's end starts the next dispatch. [Workflow](workflow.md) has each step, gate and send-back.

### The UI read path

The updater (`ui/updater.ts`) owns every derived answer: the routes in its `KEYED` list answer from it, and it builds them in a worker thread (`ui/build.ts`, `ui/build-worker.ts`). Each build records the sources it read (`lib/sources.ts`). The updater learns of a write to `aleph.db` by polling `PRAGMA data_version` every 100 ms: a new event row changes the source `events`. It watches the files that stay files (the items repo, job and factory folders, the skills, the vault, the handoffs, the annotations); when a source changes, the updater builds the kept keys again and then sends `change` with their keys. `ui/state.ts` reads the job records, the factory directory and the items repo, and writes nothing. Other `ui/api/*.ts` routes read Langfuse for sessions and skills. Every POST goes through `ui/action.ts`, which runs the `aleph` command for the action in its own process where one exists, so the UI and the CLI have one write path, and a failure is a 4xx or 5xx with `{ error }`.

## Invariants

- **One writer per store.** `aleph issue` writes the items repo; `git-guard` denies a direct edit. `aleph memory` writes the vault. `record.ts` is the only module that opens a job record.
- **Work happens in worktrees.** No edit lands on a main checkout. A worker cannot push; only the land pushes.
- **The record is on `origin/main`.** The items repo reads and writes `origin/main`. An issue is done when a commit on main names it in an `Issue:` trailer.
- **Transitions start the next step.** No step waits for the tick. The tick's sweep reports a missed transition as a bug.
- **A check with no verdict is not a failure.** A time-out or a kill is `infra`, and the rescue checks again.
- **Agents cannot widen their own power.** Code checks each director action. Security paths and `bun.lock` wait for Chris, unless he sets a land timeout for the reason.

### What a worker can change

A worker runs as Chris's OS user with Bash. Aleph has one user (Principle 1), so the gates stop a careless worker, not a hostile one.

| A worker can | Stopped | Seen |
|---|---|---|
| Edit a file an Oracle command names, on the base and outside the Edit surface | Yes: Verify fails | The check `oracle-pin` on the run |
| Edit or weaken a test in the Edit surface | No | The reviewer reads the diff. The keep-gate lists each new test that passes on the base, and the reviewer holds it for a bug fix or a behaviour change |
| Change its issue's spec with `aleph issue edit` | Yes, for the running job: the job reads the spec copied at dispatch | The store write records the actor `worker` |
| Change a held path or a security path | Yes: the run waits as a `held-path` Ask. A security path or `bun.lock` waits for Chris | The Ask |
| Write the job folder's `spec.md`, `aleph.db` or the items repo directly | No | No |
| Push to `origin/main` itself | Yes: the worker's git rewrites a push to `git@github.com:` to a dead remote (`agent-run.ts`) | The run's log |

## Cross-cutting concerns

| Concern | How |
|---|---|
| Locks | Directories under `$XDG_RUNTIME_DIR/aleph/` with an owner pid; a reboot clears them |
| Load | A check, a worker and a land start only under `ALEPH_LOAD_LIMIT` |
| Clocks | `jobs/lib/infra/clock.ts`; `tests/clock-lint.test.ts` denies a raw `Date.now()` outside the listed files |
| Cost | Each run records its cost; the Agents page and the monitor read it |
| Secrets | `~/.aleph/.env`, read by `lib/env.ts`; `secret-scan` denies a commit that adds one |
| Tests | `bun run test` in parallel; each test makes its own temp stores through the `ALEPH_*` path variables |
| Flakes | A failing check reruns once; a pass on the rerun goes to the `flaky` table and the flake tracker |
