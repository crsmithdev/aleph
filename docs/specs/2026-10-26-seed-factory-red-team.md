# Seed factory: red team of version 1

2026-10-26. Five lenses on `2026-10-26-seed-factory.md` v1 (`cae4664`): correctness and concurrency, claims and criteria, operations and live/dev, YAGNI, givens and isolation. Read-only reviews; one lens ran `claude -p --setting-sources "" --tools ""` (Claude Code v2.1.310). "S" is the spec v1.

## Fatal

1. **Every gate is advisory, because workers run as Chris's uid with `bypassPermissions`.** `bypassPermissions` is a CLI flag (unit.ts:408), so `--setting-sources ""` leaves it on. The worker keeps the real `HOME` (unit.ts:304), the repo env file (unit.ts:303), `~/.claude/.credentials.json` and the SSH keys. It can:
   - `chmod` a release or swap `~/.aleph/live/current`;
   - forge queue entries or ledger rows;
   - delete `~/.aleph/pause`;
   - edit `~/.aleph/repos.json`, which holds the checks and the day cap.

   git-guard does not load in workers and matches only Edit and Write. To-do 28 fetches a page with `curl`, so text injected into that page reaches this shell. (givens 3-8, 15, 19; claims 8, 17; ops 1)
2. **The live/dev split as written brings back the confusion Chris warned about.** (ops 1-4, 6-9; correctness 17-19)
   - A dev session runs live skills and hooks while Chris edits `~/aleph`. `skills/vault/SKILL.md:13` hard-codes the live path.
   - Nothing describes how to test a hook before deploy, and `--plugin-dir` loads it twice.
   - `~/.claude/CLAUDE.md` becomes read-only.
   - Hand lands never deploy.
   - Rollback runs through the broken release's `bin/aleph`.
   - Pruning can delete a release that running hooks or units still use.
   - Deploys have no lock.
   - git-guard cannot deny a write in a release that has no `.git` (git-guard.ts:34-35, 166-167).
3. **The proof cannot prove the unattended land.** The only pricing test is in `hooks/hooks.test.ts:358-364`, so a test the worker adds there trips the existing-test rule and the item waits. `bun test` passes with no new test. The fetched price has no oracle, and the reviewer cannot check it. To-do 27's fix may be in `hooks/lib/digest.ts`, which no held rule names, so it can land unattended or wait for the wrong reason. (claims 5-7)
4. **`--setting-sources ""` breaks two criteria by construction.**
   - It drops `autoMemoryEnabled: false` (`~/.claude/settings.json:81`), so auto memory turns on. A run confirmed this. `--bare` needs an API key.
   - It drops `obs.ts`, so no Langfuse spans exist for workers or the reviewer.

   AC 9 and AC 38 fail. (givens 1-2; claims 4; YAGNI 7)
5. **The `--shared` clone points at `~/aleph`, not GitHub.** Its `origin/main` is the dev checkout's stale `main`, which the baseline, the rebase and `aleph status` all read. The worker can push refs into `~/aleph/.git`, because the push block covers only `git@github.com:`. A gc in `~/aleph` can prune objects the clone borrows. (correctness 2-4; ops 5; givens 5)

## Correctness defects

- **The projector moves main** under the queue (three lenses). Every state change commits to `origin/main` and feeds "main kept moving". Backlog.md's board writes `status` into a checkout, which leaves it dirty. "Nothing reads it back" is false. (correctness 10; claims 10; givens 17)
- **The lease push is weaker than today's plain fast-forward push.** It accepts a non-fast-forward when the lease matches, and without an explicit SHA it reads a shared tracking ref. (correctness 1; YAGNI 6)
- **The queue is underspecified.**
  - Nothing starts the drainer.
  - Entries have no ordering key and no atomic write.
  - A crash between the push and the entry's removal re-merges a landed branch.
  - A pid lock can survive pid reuse.
  - The landing worktree has no setup and no reset.
  - The to-do fast path is dropped.
  - Pause does not stop a land in progress.

  (correctness 5-9, 22; ops 13, 23)
- **The state function has holes.**
  - The queue is an input but is not listed.
  - `stuck` has no exit.
  - `dropped` has no precedence.
  - "Done" is any `Item:` line, so a commit subject can close another item and a revert does not reopen.
  - Hand lands and old done items have no trailer, so they show as open.
  - Nothing stamps `Item:` on worker commits.
  - Several attempts give several `Job:` ids.

  (correctness 11-15; claims 11; givens 14; ops 16-17)
- **Two conflict paths** (the rebase at exit and the merge in the queue) share one unnamed counter. (correctness 16)
- **The tick can start a duplicate run** in the gap before a follow-up starts. It also re-runs waiting items every 30 minutes. (correctness 20)
- **The caps miss two kinds of run.** Reviewer and baseline runs fall outside `CAP`. A follow-up refused at `CAP` silently stalls the goal. (correctness 21; givens 18)
- **The digest loses runs.** `told` is set when Sidetone accepts a line (unit.ts:334), so the digest misses everything Sidetone was told. (correctness 23; ops 18)
- **The branch controls its own rules.** The held set and the item body can be read from the branch, so a branch can clear its own rule or rewrite its own Judge. Path rules miss imports, `package.json` scripts, `bunfig.toml` and `tsconfig.json`. (givens 9-10, 12)
- **The reviewer has no defined failure.** A timeout, bad JSON or a usage limit has no result, and the judge's fail-open path is likely copied. (claims 9; givens 13; ops 21)
- **The usage-limit string is unknown,** and the time box has no default. (claims 12, 14; ops 21)
- **Several criteria cannot be tested.** AC 8 attributes changes by `git status`. AC 24 names checkouts with no list. AC 14 compares two builds. 19 criteria have no seam. (claims 15-19)
- **Command names collide.** `aleph land` and `aleph drop` already take job names. (ops 24)
- **`aleph todo` cannot work inside a worker** because of the push block. This contradiction already exists. (givens 16)

## Architectural smells

- **The work store sits in the product repo.** Branches can edit items, the projector churns main, and the migration's scope across the registry's other repos is unspecified. (ops 15; givens 22)
- **Chris-minutes measures Claude's turn time.** The UserPromptSubmit-to-Stop span excludes Chris's reading, typing and spot checks. (claims 3)
- **No default has a basis:** 12 runs a day, the 30-minute timer, 5 releases, the 10 s smoke test, 3 tries. (claims 13)
- **The spec drifts from the decisions without a note.** It drops the plan stage, drops mid-goal defaults (SD 10), replaces the digest file, and says "per day" where the decision says "per night". (claims 21)
- **The evidence for the queue comes from outside aleph.** All 10 ledger rebase conflicts were in Sidetone; aleph had 4 lands and 0 conflicts. The counts are 75 + 1, not 76 or 78. The main evidence is Chris's account. (claims 1-2; YAGNI 18)
- **Round-1 findings are not addressed or deferred:**
  - the push-block bypasses;
  - the env file;
  - Langfuse uptime;
  - a weak new test;
  - sample size and a baseline.

  (claims 22-23)
- **"Digest" names two things,** the factory report and `hooks/lib/digest.ts`. (claims 24)

## Cheaper alternatives

- **Milestones (YAGNI 19).** The proof needs about 8 of 48 criteria. M1 would be:
  - worker isolation;
  - the usage-limit state;
  - no `followMain`;
  - a held glob sent to `needs-you`;
  - a timer over `job --todo --land`.

  The queue, reviewer, baseline, deploy, Backlog.md and digest extras would each follow as factory goals.
- **No deploy in the seed (YAGNI 1).** Land stops fast-forwarding `~/aleph`. Chris moves his checkout by hand, and rollback is `git revert`. This keeps one copy, so nothing about the split can confuse Claude.
- **Workers as a separate Unix user (givens 20).** This makes fatal 1 impossible rather than guarded. It costs copying the OAuth credentials and setting file modes on `~/.aleph`.
- **The work store in its own repo (givens 22).** Branches cannot edit items, and the projector no longer moves the product's main.
- **Server-side enforcement (givens 21).** A scoped deploy key plus branch protection would be the push block. It costs admin bypass for hand lands, and local-only checks cannot run in CI.
- **Smaller pieces of existing code:**
  - **Cost:** `total_cost_usd` from the worker's `stream-json` result event.
  - **Held set:** existing `repo.manual` globs.
  - **Workspace:** a worktree under `~/.aleph/work` instead of a clone.

  (YAGNI 7, 10, 11)

# Round 2: red team of version 2 (`ee4d251`)

Two lenses: isolation mechanics, and decisions, criteria and scope.

## Fatal

1. **Checks run worker code as Chris** (both lenses). `bun test` runs new test files and what they import. The checks carry the repo env file and Chris's `HOME`, and Chris is in the `docker` group. Today's land also reruns the checks as Chris after its rebase. This reopens round-1 fatal 1.
2. **Landed code runs in Chris's sessions after a pull.** The held list leaves out `hooks/hooks.json`, the other hooks, `skills/**`, `bin/aleph`, `.claude/settings.json`, `.mcp.json` and the root `CLAUDE.md`. In aleph, nearly every path runs in Chris's sessions.
3. **The time box does not cross the uid boundary.** `timeout`, `process.kill(-pid)` and `systemctl --user stop` signal as Chris and get EPERM. SIGKILL orphans the worker behind sudo. A worker can `setsid` and keep writing after it is recorded stuck.
4. **To-do 28's oracle is unsound.** Its one price ($0.10/M input) comes from a secondhand graphic and is marked "confirm". Output and cache prices have no source. The worker would assert its own number.

## Defects

- A bundle of `origin/main` clones empty, because it stores `refs/remotes/origin/main` (checked in scratch). The remote names are unspecified.
- One uid serves every concurrent run, and the worker's home persists. A run can edit its own `~/.claude/settings.json` or `.bashrc` and steer later runs, or push another run's branch.
- The inbox has no write-then-rename, no setgid, and umask makes the group design moot. The outbox fetch may need `safe.directory`.
- The outbox, the worker home and its clones grow without limit.
- The worker cannot run the tools. `claude` and `bun` live in Chris's 750 home, sudo's `env_reset` drops `PATH`, and no git identity is set. Repo setup commands use Chris's paths.
- `setup-token` is a one-year token on Chris's subscription and quota. It sits in every Bash child's environment, and no revocation path is named.
- The worker can reach localhost: Sidetone `/tell` (no credential), 3002, 3005, 3007, 4040, and 0.0.0.0 on 80, 8000 and 8421.
- Follow-up runs are undefined. The prompt still says `aleph todo` and "rebase on origin/main", and a fresh bundle loses the earlier branch.
- stdout and stderr share one file, so a stray stderr line after `result` makes a passing run stuck.
- Neither proof item has the `goal` label or the required sections. To-do 27 is a diagnosis, so it can end stuck with no commit.
- `landJob` refuses needs-you runs unless the reason is `manual`, so AC 23's commands fail. AC 28's paused refusal blocks Chris's own lands.
- Stuck items rerun every tick. The midnight reset allows 24 runs a night.
- The land still writes `docs/todo.md` (`squashTree`).
- The store drops `priority`, `created` and `updated`, and per-repo ids collide in one store. `Item:` does not name the repo.
- Migrated done items and hand lands have no trailer (M2 AC 35).
- About 15 criteria have no seam. `--news` already sets `told`.

## Smells

- M1 is wider than the proof: migrating all 7 repos, the board, and the behind and health lines.
- Departures from the decisions have no note: the plan stage, the digest file, and "never touch his ports".
- "Digest" names two things; "waiting" and "needs-you" name one state; "drop" names two commands.
- Workers have no Langfuse trace.
