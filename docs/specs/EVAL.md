# Construct — Eval Specification

Behavior-oriented spec for the autonomous evaluation system. Every claim here is testable.

See [SPEC.md](SPEC.md) for the application lifecycle. See [RESEARCH.md](RESEARCH.md) for the research module.

## Purpose

The eval module measures whether Claude agents behave correctly in response to Construct's hooks and verification system. It does this by running real agent sessions against real hooks in isolated sandboxes, then asserting on observable outcomes. The primary use is A/B comparison: quantifying the behavioral delta between a configuration with hooks active versus one without.

## Architecture Overview

```
Scenario definition
        │
        ▼
setupSandbox()  — isolated temp dir with task files
        │
        ▼
runEval(prompt, config)  — Claude Agent SDK session
        │     ├── Tool calls captured (edit, test, e2e, hook)
        │     ├── Hook callbacks fire actual hook scripts as subprocesses
        │     └── Hook events written to hook-events.jsonl in sandbox
        │
        ▼
Assertions  — check(), server state, git state, file state
        │
        ▼
printAndExit(results)  — pass/fail summary, exit 0 or 1
```

For A/B runs:

```
runner.ts
  ├── N trials × "with-hook" config  (Stop hook + verification prompt)
  └── N trials × "bare" config       (no hooks)
        │
        ▼
results/<timestamp>.json  — per-trial outcomes, pass rates per config
```

## Sandbox

Each eval run receives its own isolated temporary directory. The scenario's task files are written into this directory before the agent session starts. The sandbox is the agent's working directory for the duration of the run.

The sandbox contains:
- All task files specified by the scenario
- A `hook-events.jsonl` file that hook scripts append to during the run

The sandbox is not cleaned up between trials of the same scenario, but each trial gets a fresh directory.

## Hook Callbacks

Hook callbacks are the mechanism that makes evals production-equivalent. Instead of mocking hook behavior, the harness invokes the actual hook scripts as bun subprocesses.

**PreToolUse / PostToolUse callback:** When the agent calls a tool, the harness fires the corresponding hook script with the tool name and input serialized as JSON on stdin. The hook script runs identically to production — same code path, same logic, same side effects.

**Stop callback:** After the agent's session ends, the harness fires the Stop hook script. This matches the production sequence where the Stop hook runs after the agent finishes, not during.

The hook subprocess's stdout is captured. Its exit code is checked. A non-zero exit code from the Stop hook causes the eval to record a hook failure for that trial.

Hook scripts write events to `hook-events.jsonl` in the sandbox directory. These events are read back by assertions to verify hook behavior.

## Tool Call Classification

Every tool call the agent makes is classified into one of these categories:

| Category | Examples |
|---|---|
| `edit` | File write, file edit, string replace |
| `test` | Unit test execution (bun test, jest) |
| `e2e` | Playwright, Cypress, CLI execution of the built artifact |
| `hook` | Hook script invocations |

Classifications are applied using regex patterns from `patterns.ts`. The same patterns are used by hook scripts in production to detect e2e evidence — so the eval and the hooks agree on what counts.

Tool call counts per category are available to assertions after the run.

## Pattern Definitions

`patterns.ts` defines shared detection regexes used by both evals and hook scripts:

| Pattern | Matches |
|---|---|
| `E2E_CMD` | Playwright, Cypress, CLI execution of the built artifact |
| `ARTIFACT_CMD` | Screenshot capture, stdout redirect to file |
| `UNIT_TEST_CMD` | `bun test`, `jest` — excluded from e2e evidence |
| `HOOK_INVOCATION` | Hook script invocations — excluded from e2e evidence |

Because these patterns are shared between the eval harness and production hooks, a change to detection logic applies to both simultaneously.

## Assertions

`check(condition, message)` records a named pass/fail result. All checks are collected; none short-circuits the run. After the run, `printAndExit(results)` prints each check with pass/fail status and exits 0 if all pass, 1 if any fail.

Assertions available to scenarios:

- **Tool call counts** — assert that the agent made N or more calls of a given category
- **File state** — assert that a file in the sandbox has expected content or passes a predicate
- **HTTP server state** — start an HTTP server from the task files, make requests, assert on responses
- **Git state** — assert on commit history, branch state, or file tracking within the sandbox
- **Hook events** — read `hook-events.jsonl`, assert that expected events were written by hook scripts
- **Hook output** — assert on the captured stdout of hook script subprocesses
- **Hook exit code** — assert that the Stop hook exited with 0 (pass) or non-zero (block)

## Scenarios

Each scenario is a directory under `src/eval/scenarios/`. It defines:
- Task files to write into the sandbox
- A prompt to give the agent
- The assertions to run after the agent finishes

### Scenario Index

| Scenario | Category | What the agent is asked to do | How pass is determined |
|---|---|---|---|
| `broken-math` | Bug fix | Fix a `median()` function that sorts lexicographically | Unit test assertions: correct median values for mixed inputs |
| `todo-app` | Bug fix | Fix toggle (always sets done=false) and POST (returns 200+empty body) | HTTP server assertions: correct toggle behavior, correct POST response |
| `todo-feature` | Feature | Add due date field, overdue filter, sorted retrieval, and date picker to a todo app | HTTP server assertions + UI assertions: field persists, filter works, sort order correct |
| `commit-sequence` | Workflow | Execute a multi-step commit workflow | Git state assertions: correct commit history and message format |
| `e2e-basic` | Verification | Complete a task that requires running the built artifact | E2e signal detection: agent called a command matching `E2E_CMD` |
| `hook-verification-advisory` | Hook behavior | Complete a task while the advisory hook is active | Hook output assertions: hook emitted a reminder message; agent was not blocked |
| `hook-verification-gate` | Hook behavior | Attempt to finish a task without e2e evidence | Exit code assertions: Stop hook exited non-zero; agent was blocked |
| `hook-verification-pass` | Hook behavior | Complete a task with e2e evidence present | Exit code assertions: Stop hook exited 0; agent was not blocked |

## A/B Runner

The runner compares two configurations across N trials each:

| Configuration | Description |
|---|---|
| `with-hook` | Stop hook active; agent prompt includes verification reminder |
| `bare` | No hooks; standard agent prompt |

For each configuration, the runner:
1. Runs N independent trials of the target scenario
2. Records pass/fail for each trial
3. Computes pass rate

Results are saved as JSON to `src/eval/results/<timestamp>.json`. Each result file contains: scenario name, trial count, per-trial outcomes (tool call counts by category, assertion results, hook exit codes), and aggregate pass rates per configuration.

The runner does not assert that `with-hook` beats `bare` — it reports the difference and leaves interpretation to the caller.

## Running Evals

```bash
# A/B comparison across N trials
bun src/eval/runner.ts

# Single scenario, single trial
bun src/eval/scenarios/<name>/
```

Results are saved to `src/eval/results/`. Exit code is 0 if all assertions pass, 1 otherwise.

## Behavioral Properties

The following properties hold for all evals and are testable by inspection or by running the eval:

1. **No hook mocking.** Hook callbacks invoke the actual hook scripts at their installed paths. The eval fails if those scripts do not exist.

2. **Stop hook fires after run.** The Stop hook callback is invoked after the agent session ends, not during. This matches production behavior.

3. **Shared pattern definitions.** The same regexes that the eval uses to classify tool calls are the ones the production hook uses to detect e2e evidence. They cannot drift independently.

4. **All assertions run.** `check()` collects results without short-circuiting. The final output lists every assertion and its outcome.

5. **Exit code reflects all assertions.** `printAndExit()` exits 0 only if every `check()` passed. Any single failure causes exit 1.

6. **Sandbox isolation.** Each trial gets a fresh temporary directory. File state from one trial cannot affect another.

7. **Hook events are observable.** Hook scripts write structured events to `hook-events.jsonl` in the sandbox. Assertions can read these events to verify hook behavior without relying on stdout capture alone.

## Module Detection

| Module | Detection file |
|---|---|
| construct-eval | `construct/src/eval/harness.ts` |

## Common Questions

**Q: How do I add a new eval scenario?**
Create `src/eval/scenarios/<name>/` with: task files (written into the sandbox), a main file that calls `setupSandbox()`, `runEval()`, your assertions via `check()`, and `printAndExit(results)`. Use an existing scenario (e.g. `broken-math`) as a template.

**Q: Why do evals fail with "hook script not found"?**
Evals invoke real hook scripts at their installed paths (e.g. `~/.claude/construct/core/hooks/...`). Run `bun install.ts` from the repo root before running evals. The harness does not fall back to `src/` paths.

**Q: What does hook-verification-gate actually test?**
The scenario asks the agent to complete a task. Without producing e2e evidence (no Playwright, no CLI execution of the artifact), the agent tries to stop. The Stop hook detects no e2e evidence and exits non-zero. The assertion verifies that exit code was non-zero. The agent was never blocked from editing files — only from claiming completion without evidence.

**Q: How do I interpret A/B results where `with-hook` pass rate is lower than `bare`?**
A lower `with-hook` pass rate means the hook is blocking behavior the agent would otherwise exhibit. This is expected for `hook-verification-gate` — the hook *should* block completion without evidence. For `broken-math` or `todo-app` style scenarios, a lower rate indicates the hook has false positives for that task type.

**Q: How do I run a single scenario without the A/B runner?**
`bun src/eval/scenarios/<name>/` — runs one trial, prints pass/fail for each assertion, exits 0 if all pass.

**Q: Are hook events the only way to assert on hook behavior?**
No — you can also assert on hook stdout (captured per subprocess call) and hook exit codes. `hook-events.jsonl` is written by hook scripts themselves and gives structured event data; stdout capture gives you the human-readable output the hook would normally print to the terminal.
