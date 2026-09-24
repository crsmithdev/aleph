# Agent jobs: red team and revised plan

**Superseded.** Version 2 of [`2026-09-24-agent-jobs.md`](2026-09-24-agent-jobs.md)
takes in these findings and simplifies them further. Read that file. This one
keeps the evidence.

Written 2026-09-24. This document reviews
[`2026-09-24-agent-jobs.md`](2026-09-24-agent-jobs.md) and replaces the parts
that it names. Where the two disagree, this document wins. Nothing is built.

Five reviewers read the spec against the code and the data: correctness,
claims, operations, simpler alternatives, and givens. Each finding below has
an ID, the evidence, and a proposed solution. The revised plan at the end
collects the solutions.

## For an agent that reads this

- The spec's user stories stay the goal, minus the cuts in [Cuts](#cuts).
- The spec's state table, launcher, land, verdict and news sections are replaced by the solutions here.
- Do not start a milestone until Chris agrees to the revised plan. The open decisions are in [Decisions for Chris](#decisions-for-chris).

## Measured during the review

| Check | Result |
| --- | --- |
| `claude --bg` survives the stop of the unit that started it | **No.** The background daemon starts in the caller's cgroup. `systemctl --user stop` on the unit killed the daemon. The session went to `failed`, and its file was never written. `--bg` also needs a trusted directory and, for bypass mode, a one-time disclaimer. |
| A job change that passed its checks broke main | **Yes.** `e0dd6d1` reverts `2eddeb1`. Job `0921-124952-app-queue` merged that commit after unit tests passed. Its log says "Nothing has run on a device". |
| Worker permission modes in 61 past commands | 30 `--allowedTools`, 15 `--dangerously-skip-permissions`, 13 `bypassPermissions`, 3 `acceptEdits` |
| Worker prompts already forbid landing | The live lead writes "Do not merge, do not push" into its worker prompts (job `inject-race`). Nothing enforces it. |
| `userGrantedSkip` | matches `skip verify` anywhere in the prompt (`hooks/lib/digest.ts:121`) |

## Fatal findings

### F1. A passing gate does not mean a correct change

The judge checks that claims have runs behind them, not that the change is
right (`hooks/lib/judge.ts:10`). The `e0dd6d1` case passes it: the worker ran
the unit tests and said plainly that nothing ran on a device. Under the spec,
that job is `verified` and `aleph land` accepts it.

**Solution.** The verdict comes from checks that `finish` runs, not from the
gate.

- The registry gives each repo a list of `checks`: commands that run headless in the worktree, such as `bun test app`, `bunx tsc --noEmit -p .` and `./gradlew testDebugUnitTest`. Each check can name path globs, so the Android checks run only when `android/**` changed.
- The registry also gives `manual` checks: a path glob and a sentence, such as `android/**` → "run it on the phone".
- `finish` runs the checks in the worktree after the worker exits. The job passes only when every check exits 0.
- When the diff touches a path with a manual check, the state is `needs-you`, and the spoken line names the check. `land` then needs Chris to say that he did the check ("land it, checked").
- The gate outcome becomes a note in the report. A judged deny adds "claims not backed" to the spoken line. It no longer decides the state.

This handles `e0dd6d1`: `android/**` changed, so the job ends `needs-you`
with "run it on the phone".

### F2. Nothing writes `timed-out`

`RuntimeMaxSec` stops the whole unit, and `finish` runs in that unit
(spec:189-191). A killed job gets no `exit`, no `state.json` and no report.

**Solution.** The time limit kills the worker, not the unit.

- The unit's shell runs `timeout 2400 claude …`. Exit 124 means timed out. `finish` then runs normally in the same unit.
- No `RuntimeMaxSec`.
- `ALEPH_JOB_TIMEOUT` sets the seconds, so a test can use 2 s. This works in the foreground mode too.
- A reboot leaves a folder with `pid`, no `exit` and a dead process. Every reader treats that folder as `failed` with the reason "lost". `aleph jobs` writes that state the first time it sees one (see C2).

### F3. The branch model contradicts itself

Criterion 7 gives every job a new branch. A blocked resume, `land-fix` and
the review job all reuse a branch, and git refuses one branch in two
worktrees.

**Solution.** One job has one branch and one worktree for its whole life. A
follow-up is a new **run** of the same job, not a new job.

- `aleph job <repo> <name>` creates the job and its first run.
- `aleph resume <name> "<words>"` starts the next run in the same worktree. It uses `claude -p --resume <session-id>`, so the worker keeps its context. It serves an answer to a blocked question, a fix after a failed land, and "try again".
- The ledger holds `runs/1/`, `runs/2/`, and so on. Each holds its own `command.txt`, `output.log`, `exit` and report. The job's `state.json` sits at the top.
- A name stays taken until the job is landed, dropped or done. There are no parent pointers and no `landing` state. A fix run ends in a state like any other run.

### F4. A worker can go around its own gate

The worker owns `ALEPH_JOB_DIR`. git-guard exempts `~/.aleph`
(`hooks/git-guard.ts:27`), and nothing guards Bash. The global CLAUDE.md tells
every session to land and push. 7 past jobs merged to main themselves. A spec
that contains "skip verify" gives a `skip` pass.

**Solution.** Enforce in hooks, and keep the verdict out of the worker's reach.

- F1 moves the verdict to `finish`, which runs after the worker exits. A worker that writes `gate.json` or `state.json` changes nothing, because `finish` writes them from its own runs.
- A new PreToolUse rule, active only when `ALEPH_JOB_ID` is set, denies these Bash commands: `git push`, `git merge`, `git rebase`, `git checkout` or `git switch` to another branch, `git worktree`, and `git -C` or `cd` into a path outside the job's worktree. It also denies Edit and Write outside the worktree.
- `userGrantedSkip` returns false when `ALEPH_JOB_ID` is set.
- The worker prompt's rules block becomes fixed text in aleph, with "do not merge, do not push". It is no longer text that the lead writes each time.

## Correctness defects

| ID | Defect | Solution |
| --- | --- | --- |
| C1 | The cap and the name check race (check-then-act) | Take the lock `~/.aleph/jobs/.lock` with an atomic `mkdir` around the check and the folder creation. Free it when the folder exists. A lock held for more than 10 s is stale and is broken. This lock covers dispatch only; it is not the rejected lock before each write. |
| C2 | "Running" has two definitions | One rule, written once in the folder contract: a run is live when `pid` exists, `exit` does not, and that pid's command line names the run folder (Sidetone 14.10.4). `state.json` `running` is a cache. A reader that finds `running` with no live run treats it as `failed` ("lost"), and `aleph` writes that state. |
| C3 | A reader can see a half-written file | Write `state.json`, `report.md` and `verdict.json` to a temporary name, then rename. |
| C4 | `gate.json` can be stale or missing (a 45 s hook timeout against a 2 × 30 s judge) | F1 makes the gate a note. Each Stop in a job appends one line to `runs/<n>/gate.jsonl`, and `finish` reads the last line. A missing line is reported as "gate did not answer" and changes no state. |
| C5 | A nested `claude -p` inside a worker overwrites the gate file | The launcher gives the worker `--session-id <uuid>` and sets `ALEPH_JOB_SESSION` to it. The gate writes to the job folder only when its session id equals `ALEPH_JOB_SESSION`. |
| C6 | `snapshot` hashes every worktree, so a research job looks changed | `finish` decides "no change" from the job's own worktree: no commits past the base and a clean tree. It does not use the gate's snapshot. |
| C7 | The state table has no order | Fewer states (see [States](#states)) and one order: `timed-out` > `failed` > `blocked` > `needs-you` > `passed` > `done`. |
| C8 | A `no-change` job can land with nothing to merge | A run with no change ends `done`. `finish` removes its worktree and branch. `land` refuses a `done` job with "nothing to land". |
| C9 | `landing` has no exit, and `land-fix` needs a parent pointer | F3 removes both. A failed land starts a fix run of the same job. |
| C10 | A review job cannot start from inside `finish` | `--review` is cut (see [Cuts](#cuts)). If it returns, it is a run of the same job. |
| C11 | Land is not atomic: a dirty main checkout, two lands at once, a push rejected after the local merge | Land never touches the main checkout before the push succeeds. (1) Take the repo lock `~/.aleph/jobs/.land-<repo>`. (2) `git fetch`, then rebase the job branch onto `origin/<main>` in the job worktree. (3) Run the checks. (4) Build the squash commit with `git commit-tree` from the branch tree, with `origin/<main>` as its parent. (5) Push that commit to `<main>`; the remote refuses anything but a fast-forward. (6) If the main checkout is clean and on `<main>`, `git merge --ff-only`; if it is not, say so and leave it. (7) Remove the worktree and the branch. Each step writes its step name to `state.json`, and `land` run again continues from the last step. A rebase conflict or a failed check starts a fix run (F3) and changes nothing else. |
| C12 | `bun test` is the wrong default; new worktrees lack `node_modules` and `corpus` | No default. A repo entry must list `checks`, and it can list `setup` commands that `aleph job` runs after it creates the worktree (`bun install`, `ln -s ~/cloudchamber-corpus corpus`). A setup that fails ends the job `failed` before any worker starts. |
| C13 | `--allowedTools` does not restrict the tool set, and an allowlist worker is unproven | Use `--tools Read,Write,Edit,Bash,Grep,Glob,Skill` to fix the set, and `--permission-mode bypassPermissions`, as 28 of 61 past jobs did. The F4 hook rule is the enforcement. Measure one run in allowlist mode before milestone 1; if it finishes a Sidetone build, prefer it. |
| C14 | The environment is unspecified, and an inherited `ANTHROPIC_API_KEY` bills the API | The launcher passes only `HOME`, `PATH` (the dispatcher's), `ALEPH_*`, and the repo's `env` file from the registry (Sidetone's `~/.sidetone/env` for CUDA). It unsets `ANTHROPIC_API_KEY`, as the judge does (`hooks/lib/judge.ts:33`). |
| C15 | The session id arrives only at exit | `--session-id <uuid>` from aleph (C5), written to `state.json` before the worker starts. `--output-format stream-json --verbose` writes to `output.log` as the run goes, and `finish` reads the last `result` event. |
| C16 | The `heard` marker is unreliable (`announce` has no "played" callback) | News is a push (see D5). No `heard` marker. |

## Operational and design findings

| ID | Finding | Solution |
| --- | --- | --- |
| D1 | A land has side effects the spec ignores: Cloud Chamber reloads on a commit to main, a Sidetone land needs a restart that kills the speaking bridge, and an aleph land swaps live hooks | The registry gets `after_land`, a command that runs after the push and the fast-forward. Cloud Chamber needs none: its `post-merge` hook runs `.githooks/reload` on the fast-forward of step 6. When step 6 is skipped, `land` says that the reload did not run. Sidetone: `systemd-run --user --on-active=20s systemctl --user restart sidetone.service`, so the bridge speaks "landed" before it restarts. aleph gets `exclusive: true`: `land` refuses while any aleph job runs. |
| D2 | Secrets can reach speech, the phone and the land commit | `finish` runs the secret-scan detector (`hooks/lib/scan.ts`) over the report and the spoken line, and replaces each match with `[secret]`. `land` runs the same detector over the squash diff and refuses on a match. |
| D3 | 11 of 39 stories answer no observed event; 5 of 12 states never occurred | See [Cuts](#cuts) and [States](#states). |
| D4 | The 3.75 h estimate is not credible | New estimate in [Milestones](#milestones). |
| D5 | Watching the ledger adds `heard` and `reminded` state to the bridge | `finish` POSTs the spoken line to `/say`, as `scripts/job` does. `mouth.announce` already holds news until the turn ends (`sidetone/src/bridge.ts:218`). If the POST fails, `finish` writes `unsaid` in the job folder. At start, the bridge speaks each `unsaid` file and deletes it. Each file has one writer and one reader. |
| D6 | The cap ignores `scripts/job` jobs during the migration | The cap counts live runs in both `~/.aleph/jobs` and `~/.sidetone/jobs` (the 14.10.4 rule) until `scripts/job` is removed. |
| D7 | Vocabulary: aleph has no glossary, and "verified" names both a gate score and a job state | Add `CONTEXT.md` to aleph with: job, run, worker, lead, check, manual check, verdict, land, drop. Job states do not use the word "verified". |
| D8 | Milestone 3 lands in two repos at once | With D5, aleph already POSTs in milestone 1. Milestone 3 becomes Sidetone only. |

## Measurement corrections

| ID | Claim | Correct value | Action |
| --- | --- | --- | --- |
| M1 | 135 commits on Sidetone main, 21–24 Sep | 152 to 14:35 on 24 Sep. The 135 came from `--since` with no time. | Republish the Sidetone Job Floor page with the correct numbers. Done in the vault note. |
| M2 | 63 finished agent jobs, 61 exit 0 | 68 and 66 when every command that contains `claude` counts; 63 and 61 with `claude` and ` -p` | State the filter in every place that uses the number. |
| M3 | 1.46× parallelism, 260 busy minutes | 1.43×, 302 minutes, with the wider filter | as M2 |
| M4 | "Lands by trust" and "no end state" | The measured cost is one reverted change (`e0dd6d1`) and stale bookkeeping in the to-do list (`efad51e`). No stray branches exist now. | The Problem Statement cites these two, and nothing else. |
| M5 | Outside evidence | The habituation study measures reviewer experience, not queue size. The 19.8% is per pair of co-active PRs across 2,807 repos. Claim Plane also raised integration success from 65.6% to 96.7%. | Cite them as direction, not as numbers that apply here. |
| M6 | Cross-repo demand | 0 of 68 jobs ran outside Sidetone. Cloud Chamber had 147 typed traces ($473 at list price) in the same days. Cross-repo jobs are Chris's forecast. | Milestone 2 proves it with a real Cloud Chamber job. |
| M7 | The cap of 4 and the 40-minute limit | The cap would have held jobs back for 12.5 minutes in 4 days. The limit would have killed 0 of 68 jobs; the longest ran 25.3 minutes. | Keep both as backstops, and say that they are backstops. |

## Cuts

These spec stories leave milestones 1 to 3. Each returns when an event asks
for it.

| Story | Feature | Reason |
| --- | --- | --- |
| 3 | dispatch from a scheduled routine | 0 events; works anyway, because any shell can run `aleph job` |
| 9, 10 | file-overlap warning | 0 conflict-fix commits in 249; non-blocking, so it changes no decision |
| 21 | `--review` | 0 requests; a run of the same job can do it later |
| 25 | status line summary | voice is the main path; `aleph jobs` answers the question in a typed session |
| 33 | 24-hour waiting line | the limit is a guess; `aleph jobs` lists the waiting jobs |
| 23 | replay of missed verdicts from the last 24 hours | replaced by `unsaid` (D5) |

Kept: the model override (one flag), "a worker cannot dispatch" (one check),
and the trace link (C15 gives it at no extra cost).

## States

| State | Meaning | Next |
| --- | --- | --- |
| `running` | a run is live | any end state |
| `passed` | every check passed, and no manual check applies | `landed`, `dropped`, a new run |
| `needs-you` | the checks passed, and a manual check applies | `landed` after Chris confirms, `dropped`, a new run |
| `failed` | a check failed, the worker failed, setup failed, the land failed, or the run was lost | a new run, `dropped` |
| `blocked` | the worker asked a question | a new run with the answer, `dropped` |
| `timed-out` | the run hit the time limit | a new run, `dropped` |
| `done` | no change; the worktree is removed | none |
| `landed` | pushed to main | none |
| `dropped` | removed with a reason | none |

The spoken line always carries the gate note when the gate denied, or did not
answer.

## Revised registry entry

```json
{
  "cloudchamber": {
    "path": "~/cloudchamber",
    "aliases": ["cloud chamber"],
    "main": "main",
    "setup": ["bun install", "ln -s ~/cloudchamber-corpus corpus"],
    "checks": [
      { "run": "bun test app" },
      { "run": "bunx tsc --noEmit -p .", "when": ["app/**", "*.ts"] }
    ],
    "manual": [{ "when": ["app/ui/**"], "say": "look at the change in the browser" }]
  }
}
```

The values are examples. Milestone 1 writes the real entries for aleph,
Sidetone and Cloud Chamber from each repo's own `CLAUDE.md`.

## Milestones

| # | Repo | Content | Done when | My time |
| --- | --- | --- | --- | --- |
| 0 | none | Measure one allowlist-mode worker on a Sidetone build (C13) | the result is written in this document | ~15 min |
| 1 | aleph | registry; `aleph job` with lock, worktree, setup, launcher with `timeout`, `--session-id`, stream log; `finish` with checks, manual checks, gate note, redaction, POST or `unsaid`; `aleph jobs`; the job Bash rule; the `skip verify` fix; `CONTEXT.md` | the CLI tests pass with a fake worker, including timeout and lost runs; one live run in a scratch repo ends `passed` | ~3 h |
| 2 | aleph | `land` in seven resumable steps with `after_land`; `resume`; `drop` | CLI tests for land, a conflict, a rejected push and a second land pass; a real Cloud Chamber job lands, and Cloud Chamber reloads | ~2.5 h |
| 3 | sidetone | the bridge speaks `unsaid` at start; the working sign counts both ledgers; `CLAUDE.md` names `aleph job`; spec 14.10.4 changes | reader tests pass; a spoken job goes to "land it" from the phone | ~1 h |
| 4 | sidetone | remove `scripts/job`; the cap and the working sign read one ledger | `scripts/job` is gone and the tests pass | ~15 min |

## Decisions for Chris

1. **F1, manual checks.** Should "land it" on a `needs-you` job need the words "checked", or is a spoken confirmation after the bridge names the check enough?
2. **C13, permission mode.** Bypass plus the hook rule, or allowlist mode if milestone 0 shows it works?
3. **D1, Sidetone restart.** Restart 20 s after a land, or only when Chris says "restart"?
4. **Cuts.** Agree to the six cuts, or keep any of them?

## Round 2

Three reviewers read version 2: correctness, operations, and
simplification. Version 3 of the spec takes in the result.

| Finding | Version 3 |
| --- | --- |
| `exit` was written before `finish`, so a run looked dead during its checks: the lost rule fired, the cap under-counted, the working sign went off | The unit writes `exit` last. A run is live from setup to the end of its checks. The lost rule only reports. |
| The checks had no time limit | Each check runs under `timeout`; measured: `timeout` stops the whole process group |
| The 10 s stale-lock rule broke under a slow setup | A lock holds the owner's pid and is stale only when that pid is dead. Setup runs in the unit, outside the lock. |
| A regex Bash rule misses `bash -c`, `git -c` and `update-ref` (measured: `update-ref` in a worktree moved the shared `main`), and blocks normal commands | No Bash rule. The worker's push goes to a host that does not exist (measured: exit 128, fetch still works). Land builds from `origin/main`. |
| Denying writes outside the worktree breaks real workers (scratch summaries, the vault) | Cut |
| Checks ran on uncommitted edits that land would not push | A run with tracked changes fails with "uncommitted changes" |
| `worktree remove` and `branch -d` fail on untracked files and squash-landed branches (measured) | `--force` and `-D` |
| Tree-equality recovery gave false positives | Cut. `landed` is written right after the push. Equal trees end `done`. |
| `land --checked` could skip a worker's question | `--checked` applies to manual checks only |
| `--session-id` with `--resume` | `--resume` cut; each run gets a new session id and the previous `result.md` |
| The `QUESTION:` text reached speech and the phone | aleph says only "has a question"; the lead reads it |
| `/say` needed a URL and a TLS rule | `$SIDETONE_SAY_URL`, default loopback, certificate check skipped for it only |
| Land ran inside the lead's Bash call: tool limits and barge-ins | Land is a run in its own unit |
| 21 past jobs were plain commands with no runner after migration | `aleph run <name> -- <command>` |
| An aleph land swaps hooks under live workers | `quiet: true` on aleph: its land waits for no live agent run |
| Sidetone's registry had no source; worktrees lack `local.properties` | Checks taken from the lead's worker rules; setup copies `local.properties` |
| An env file's `PATH` overrode the dispatcher's | The unit sets `PATH` after it loads the env file |
| Aliases, `CONTEXT.md`, resume rotation, the "already pushed" recovery, two-ledger cap | Cut |
| The estimate | ~5 h over three milestones |
