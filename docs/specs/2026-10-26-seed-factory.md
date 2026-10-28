# Seed factory

Written 2026-10-26. Version 3, with the sandbox section corrected by the `srt` probe of 2026-10-27 (to-do 32). Milestones 1 and 2 built on 27 Oct, apart from the proofs; see "As built". To-do 31.

- Version 1 (`cae4664`) went through a five-lens red team.
- Version 2 (`ee4d251`) took Chris's answers to it: a separate worker, one copy of aleph and no deploy, the work store in its own repo, and milestones. Version 2 went through a two-lens red team; both rounds are in [`2026-10-26-seed-factory-red-team.md`](2026-10-26-seed-factory-red-team.md).
- Version 3 takes Chris's answers to round 2: Anthropic's sandbox-runtime (`srt`) in place of a second Unix user; for aleph, the pull is the review; and to-do 28's prices come from Chris's session.
- 2026-10-27 (Chris, aleph-140): the land calls `followMain` again. After the push it fast-forwards the repo's clean main checkout, and restarts aleph-ui when an aleph land changes `ui/`. Chris will not pull `~/aleph` himself, so "the pull is the review" no longer holds.

The map is [`2026-10-25-goal-to-shipped.md`](2026-10-25-goal-to-shipped.md); this spec is its "seed". The decisions and the earlier red teams are in `~/.aleph/handoffs/seed-decisions.md` and `~/.aleph/handoffs/red-team/`.

## Problem Statement

Chris wants to give aleph a one-sentence goal and get it built, checked and landed with about 10 minutes of his own time. His time is the constraint, not agent hours. The parts exist, but they do not join into a factory, and the parts that move code are not safe to leave alone:

| Problem | Evidence |
|---|---|
| Workers, and the checks that run their code, can do anything Chris can | They run as Chris's uid with `bypassPermissions`, his `HOME`, SSH keys, OAuth credentials and the repo env file. The push block is one `pushInsteadOf` rule. A worker can edit `~/.aleph/repos.json` (the checks) and `~/.claude/settings.json`. On WSL2 any Linux process can also start Windows programs through `/run/WSL` and write `C:\Users\crsmi\.ssh` through `/mnt/c` (probed 26 Oct). |
| A land changes the code Chris's sessions run | `~/aleph` is the live plugin, `~/.local/bin/aleph` and `~/.claude/CLAUDE.md`. A land fast-forwards it. |
| A worker that hits the usage limit can read as done | An exit 0 with no commits counts as done, and its worktree is removed. |
| Several lands at once do not queue well; the to-do list falls out of step; agents cannot tell what has landed | Chris, 26 Oct. The ledger has 75 land runs from 25-29 Sep, before the fixes `e0c6fe8` and `85de789`; all 10 rebase conflicts there were in Sidetone. Nothing has measured the current code, so Chris's account is the evidence. |
| The to-do list lives in each product repo | Every to-do write is a commit on that repo's main; six of the ten Sidetone conflicts were only on `docs/todo.md`. A worker on a branch can edit its own item. |
| The runner sits idle | The ledger's last run is 3 Oct. No aleph commit since 1 Oct came through `aleph job`. |

## Solution

**Milestone 1, the seed:**

1. Chris runs `/aleph:goal` and states a goal in one or two sentences. A short product-level grill follows, with a recommended answer for each question. It writes one item to the **work store**, a git repo of its own. The item gives the goal, the edit surface, the oracle and the time box.
2. A systemd timer starts a run for each open goal item, within the caps. The worker runs under `srt`, Anthropic's sandbox-runtime, inside the systemd user unit aleph starts today.
   - It sees only its own run folder and the `claude` and `bun` binaries. It does not see Chris's home, `/mnt`, `/run` or the docker socket.
   - It reaches only `api.anthropic.com` and the npm registry.
   - It gets the code as a git bundle of `origin/main` and hands its branch back as a bundle.
3. The repo's checks run in a second `srt` call, in the same folder. Worker code never runs as Chris.
   - A run that reports an error or makes no commit is stuck, never done.
   - A diff that touches a held path or edits an existing test needs Chris.
   - Otherwise `aleph land` lands it on `origin/main`. It no longer touches `~/aleph`.
4. Chris's checkout moves only when he runs `git pull`, and for aleph that pull is his review. Rollback is `git revert`. The next session he opens shows the **report**:
   - what landed, and the diff a pull would bring;
   - what needs him, and why;
   - what is stuck;
   - the cost;
   - how far `~/aleph` is behind `origin/main`;
   - a health line.
5. `aleph pause` stops the factory. The sandbox cannot reach the pause file.

**Milestone 2:** a serial land queue that merges in memory and pushes exactly the tree it tested, and item state derived from `Item:` trailers on `origin/main`.

**Later**, each as a factory goal: the reviewer, the baseline check on main, and the report's extras.

## User Stories

### Milestone 1

#### Intake

1. As Chris, I want to state a goal in one or two sentences with `/aleph:goal`, so that starting work costs me almost nothing.
2. As Chris, I want the grill to ask only product-level questions, each with a recommended answer, so that I can answer fast or say "use your defaults".
3. As Chris, I want the grill to wait for my answer, so that the factory never starts on a guess I did not make.
4. As Chris, I want each item to state its edit surface, its oracle and its time box, so that I see what the worker may change, what decides success and how long it gets.
5. As Chris, I want facts the oracle needs, such as prices, fetched in my session during the grill and confirmed by me, so that the worker never fetches and never sets its own answer.
6. As Chris, I want a question that comes up mid-run answered with its recommended default and listed in the report, so that the run does not stop for me.

#### Work store

7. As Chris, I want every repo's items in one git repo of their own, so that no product repo's main moves when an item changes and no branch can edit its own item.
8. As Chris, I want `aleph todo` to keep its commands and its fields, so that my habits and the skills keep working.
9. As Chris, I want the items of every registry repo moved into the store in one step, so that there is one list and no second write path.
10. As Chris, I want Backlog.md's board on the store, so that I have a board before aleph's UI exists.

#### Sandbox

11. As Chris, I want each worker run and each check to run under `srt` with a whitelist filesystem, so that worker code cannot read or write my home, keys, credentials, gate files, Windows drives or the docker socket.
12. As Chris, I want the sandbox's network limited to Anthropic's API and the npm registry, with private and tailnet ranges denied, so that a worker cannot reach my local services or send my code anywhere else.
13. As Chris, I want each run to start from an empty home and to leave nothing behind, so that no run can steer a later one.
14. As Chris, I want the time box to kill every process the run started, so that nothing keeps writing after a run is over.
15. As Chris, I want workers to bill to my subscription through a token of their own, so that they cost nothing extra and never touch my login.
16. As Chris, I want code to go in and out of the sandbox only as git bundles, so that aleph never runs anything from the worker's repo.
17. As Chris, I want a probe command that tries each forbidden access from inside the sandbox, so that I can see the isolation hold before the first run and every night.

#### Making and landing

18. As Chris, I want the factory to start runs for open goals by itself, so that work happens while I do other things.
19. As Chris, I want a run that reports an error, hits the usage limit or makes no commit to be stuck, so that a partial result never counts as done.
20. As Chris, I want a stuck goal left alone until I retry it, so that it does not spend the cap.
21. As Chris, I want a diff that touches a held path, or edits, deletes or skips an existing test, to need me, so that the factory cannot loosen its own gate.
22. As Chris, I want the held paths read from my side, not from the branch, so that a branch cannot clear its own rule.
23. As Chris, I want to land or drop a held run with one command, so that answering it is cheap.
24. As Chris, I want a land to touch no checkout of mine, so that my sessions run only code I pulled.
25. As Chris, I want every landed commit to carry `Item:` and `Job:` trailers, so that I can find the work for an item in git.

#### Report

26. As Chris, I want the next session I open to show what changed since I last saw the report, so that I read one report.
27. As Chris, I want each held run shown with its diff stat, its reason and the commands to land or drop it, so that I check without re-deriving.
28. As Chris, I want the report to show what a `git pull` of aleph would bring, so that my pull is an informed review.
29. As Chris, I want the report to show each run's cost and the runs used against the cap, so that I see the budget.
30. As Chris, I want a health line when the factory did nothing for a day with an open goal, or when the nightly probe failed, so that a silent failure shows.

#### Budget and stop

31. As Chris, I want a cap on runs in any 24 hours, so that the factory leaves quota for my own sessions.
32. As Chris, I want `aleph pause` and `aleph resume`, so that I can stop the factory at once and start it again.
33. As Chris, I want the factory idle when no goal is open, so that it costs nothing.

#### Proof

34. As Chris, I want to-do 28 run through the factory for real, so that I know the unattended land works.
35. As Chris, I want to-do 27 run through the factory, so that I know a held change reaches me.
36. As Chris, I want each proof to record my minutes, the cost and the result, so that "about 10 Chris-minutes" is a number.

### Milestone 2

37. As Chris, I want branches from several runs to land one after another without manual steps, so that parallel work does not break the land.
38. As Chris, I want the checks to run on the exact tree that is pushed, so that main is never a tree nobody tested.
39. As Chris, I want an item done when, and only when, a commit with its trailer is on `origin/main`, so that the list and main cannot disagree.
40. As Chris and as a worker, I want `aleph status <item>` to answer from git and the ledger, so that nobody guesses from their own tree.

## Acceptance Criteria

### Milestone 1

1. WHEN Chris runs `/aleph:goal` with a one-sentence goal THE skill SHALL ask its questions in the question UI, each with one option marked "(Recommended)".
2. WHEN Chris answers "use your defaults" THE skill SHALL write the item with the recommended answers and list them under "Defaults taken".
3. WHILE the grill has unanswered questions THE skill SHALL write no item.
4. WHEN the skill writes an item THE item SHALL have the label `goal` and non-empty body sections "Goal", "Edit surface", "Oracle" and "Time box".
5. WHEN the oracle needs a fact from the web THE skill SHALL fetch it in Chris's session, show it with its source URL as the recommended answer, and write the confirmed value and the URL into "Oracle".
6. WHEN a worker's result contains a line starting `DEFAULT:` THE report SHALL list that question and the answer the worker took, and the run SHALL not need Chris because of it.
7. WHEN any `aleph todo` write runs THE commit SHALL be on the work store's `origin/main`, and no product repo SHALL get a commit.
8. WHEN `aleph todo list <repo>` and `aleph todo show <repo> <n>` run after the migration THEIR output SHALL equal their output before it, for every registry repo and every item.
9. WHEN the migration runs THE store SHALL hold one Backlog.md file per item, named `<repo>-<n>`, and each registry repo SHALL get one commit that removes `docs/todo.md` and names the store.
10. WHEN Chris runs `backlog browser` in the store THE board SHALL show the open items.
11. WHEN `aleph sandbox probe` runs THESE SHALL fail inside the sandbox: reading `~/.ssh`, `~/.claude` and `~/.aleph`; the docker socket; `/mnt/c/Windows/System32/cmd.exe`; `127.0.0.1:3010`; `172.17.0.1:8421`; a tailnet address; and `https://example.com`. THESE SHALL pass: `claude -p "say ok"` and `bun test` in aleph.
12. WHEN a run's sandbox starts THE home it sees SHALL be empty apart from the Claude Code settings aleph writes (auto memory off, no plugins), and WHEN the verdict is recorded THE run folder SHALL be gone.
13. WHEN a run reaches its time box THE unit SHALL end, `systemctl --user status` SHALL show no process left in its cgroup, and the run SHALL be stuck with the reason "time box".
14. WHEN a worker runs THE environment inside the sandbox SHALL hold the worker token and no variable from Chris's environment or the repo env file.
15. WHEN aleph takes a worker's result THE only operation on worker data SHALL be `git fetch` of `factory/<job>` from the run's `out.bundle`.
16. WHEN the timer fires WHILE an open `goal` item has no live run, no held run and no stuck run, the factory is not paused, and the caps allow it THE factory SHALL start one run for that item.
17. IF the last line of the worker's stdout is not a `stream-json` `result` event with `is_error` false, OR IF the bundle holds no commit beyond `origin/main` THEN THE run SHALL end stuck with that line's text, whatever the exit code.
18. WHEN Chris runs `aleph job aleph <name>` on a stuck goal THE factory SHALL start a follow-up run whose bundle holds the previous `factory/<job>` branch.
19. IF the diff touches a held path that is not a test file, deletes or renames an existing test file, removes or changes a `test`, `it`, `describe` or `expect` line in an existing test file, or adds `.skip`, `.only` or `.todo` to a test THEN THE run SHALL end needs-you with the matched rule and the diff stat, and nothing SHALL be pushed.
20. WHEN aleph checks a diff against the held paths THE paths SHALL come from `~/.aleph/repos.json`, and a held-path change on the branch SHALL not change the verdict.
21. WHEN Chris runs `aleph land <name>` on a needs-you run THE land SHALL proceed and add the trailer `Held-by: Chris`, and WHEN he runs `aleph drop <name>` THE run SHALL be dropped and the item left open.
22. WHEN a land completes THE `HEAD`, index and working tree of `~/aleph` and of every worktree in `git -C ~/aleph worktree list` SHALL be unchanged.
23. WHEN a land pushes a commit THE message SHALL end with exactly one `Item: <repo>-<n>` and one `Job: <job>` trailer, and no worker commit subject SHALL form a trailer line.
24. WHEN a land runs THE squash commit SHALL not contain `docs/todo.md`, and the item SHALL be marked done in the store after the push.
25. WHEN Chris opens a session WHILE the report has entries he has not seen THE SessionStart hook SHALL print them through `aleph report` and mark them `shown`, whatever their `told` flag.
26. WHEN the report shows a needs-you run THE entry SHALL give the diff stat, the matched rule, and the commands `aleph land <name>` and `aleph drop <name>`.
27. WHEN `~/aleph` is behind `origin/main` THE report SHALL give the commit count and `git diff --stat` between them.
28. WHEN the report shows a run THE entry SHALL give the `total_cost_usd` of its `result` event, labelled as the API price, and the report SHALL give the runs in the last 24 hours against the cap.
29. IF no run started in 24 hours WHILE an open `goal` item exists and the factory is not paused, OR IF the last nightly `aleph sandbox probe` failed, THEN THE report SHALL print a health line that says so.
30. WHEN the runs in the last 24 hours reach the cap THE timer SHALL start no run.
31. WHEN Chris runs `aleph pause` THE timer SHALL start no run, the unit SHALL start no follow-up, and a factory land SHALL not start, each logging "paused"; Chris's own `aleph land` SHALL still work. WHEN he runs `aleph resume` THE next tick SHALL start runs again.
32. WHILE no open `goal` item exists THE timer tick SHALL start no `claude` process.
33. WHEN to-do 28 runs through the factory THE result SHALL be one commit on `origin/main` with both trailers, a new test file that asserts the confirmed Haiku 5.5 prices from the item's Oracle section, and a passing `bun test`, with no step by Chris between the grill and the land.
34. WHEN to-do 27's run makes a commit THE result SHALL be a needs-you entry in the report whose matched rule is the held path `hooks/lib/digest.ts`.
35. WHEN a proof run ends THE file under `tests/live` SHALL record Chris's minutes, the cost, the number of runs and the result.

### Milestone 2

36. WHEN three branches of one repo are ready to land THE queue SHALL land them one at a time in the order they became ready, and `origin/main` SHALL end with three squash commits.
37. WHEN the queue lands a branch THE pushed commit's tree SHALL be the tree the checks ran on, and the push SHALL be a plain fast-forward push.
38. WHEN a commit whose trailer block holds `Item: <repo>-<n>` is on `origin/main` and has not been reverted THE item SHALL be done in `aleph status`; WHILE none is THE item SHALL be done only if the store says so and no factory run touched it.
39. WHEN `aleph status <item>` runs in Chris's session and inside the sandbox from the same bundle THE two outputs SHALL be identical.

## Implementation Decisions

### What this spec treats as fixed

- `origin/main` on GitHub is the record of what has landed. Chris's checkout and the bundles follow it; neither leads it.
- Workers are `claude -p` runs started by Chris's systemd user units, as today. Dynamic Workflows are a tool inside a stage; Managed Agents need API billing; cloud scheduled tasks are the "cloud later" option.
- `aleph land`'s current land path stays for milestone 1: its lock, the base it pins, `BOUNCES`, `RELANDS` and the plain push. It loses `followMain` and the `docs/todo.md` write, runs its checks under `srt`, and gains the held-path rule. Milestone 2 replaces it.

One given moves: the map's "`aleph land` is the only path to `main`" becomes "the factory's only path to main". Chris still lands his own work by hand.

### Departures from the grill's decisions

| Decision | Change | Why |
|---|---|---|
| 2: grill, plan, build, check, land, digest | No plan stage | One goal is one run in the seed; decomposition is later. |
| 5: the digest file `~/.aleph/digest/<date>.md` | `aleph report`, from the ledger, in SessionStart | The ledger already holds the facts; a file is a second store. "Digest" also names `hooks/lib/digest.ts`, so the factory's one is the **report**. |
| 6: GitHub Issues | A work store repo of Backlog.md files | Chris, 26 Oct. |
| 7: a share of the weekly quota | 12 runs in any 24 hours | No code reads the quota. Twelve 40-minute runs fill a night. |
| 8: always on, never touching Chris's ports | A 30-minute timer; the sandbox denies private ranges | Always-on is not needed for the proof. |
| 3: hold hooks and gates | Hold the gate; for aleph, Chris's pull is the review | Chris, 26 Oct. Nearly every aleph path runs in his sessions, so holding them all holds every goal. |

### Sandbox

- **Tool.** `@anthropic-ai/sandbox-runtime` (`srt`), pinned. Version 0.0.79 is installed with `npm i -g --prefix ~/.aleph/tools`, outside every path a sandbox can write. It needs `socat` from apt, the one root step; `socat` 1.8.0.0 is installed (27 Oct). Anthropic names `srt` as the way to run all of Claude Code unattended. The built-in `/sandbox` covers only shell commands.
- **Run folder.** `~/.aleph/runs/<id>/`, with `in.bundle`, an empty `home/`, `work/` and `tmp/`, `sock/`, `srt.json`, and later `out.bundle`. The profile must not allow reads of the whole run folder: `srt` mounts it read-only over the writable `home/` and `work/`. `srt` itself runs with `TMPDIR=sock/`, so its proxy sockets are in the run folder and not in the host's `/tmp`; the worker gets `TMPDIR=tmp/`. aleph removes it after the verdict.
- **Profile (`srt.json`):**
  - `denyRead`: `/home`, `/root`, `/mnt`, `/run`, `/var/run`, `/srv`, `/tmp`;
  - `allowRead`: `in.bundle`, `sock/`, the pinned `claude` and `bun` files, and `srt`'s own `vendor/` folder (its seccomp helper is under `/home`);
  - `allowWrite`: `home/`, `work/` and `tmp/`;
  - `deniedDomains` and `denyWrite` as empty lists, because `srt` refuses a file without them;
  - `allowedDomains`: `api.anthropic.com` and `registry.npmjs.org`;
  - deny the resolved addresses in RFC 1918, `100.64.0.0/10` and `172.17.0.0/16`.
- **Start.** The unit is started as today, with `RuntimeMaxSec` set to the time box. `unit.ts` runs `env -i … srt --settings srt.json -- claude -p … --permission-mode bypassPermissions --output-format stream-json`. The clean environment is set outside `srt`, because `srt` adds the proxy variables the sandbox needs:
  - `HOME` and `CLAUDE_CONFIG_DIR` under `home/`, where aleph writes `settings.json` with `autoMemoryEnabled: false` and no plugins;
  - `PATH` to the pinned binaries;
  - `CLAUDE_CODE_OAUTH_TOKEN`;
  - `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and `DISABLE_AUTOUPDATER=1`.

  stdout goes to `output.log` and stderr to `stderr.log`.
- **Code in and out.**
  1. Inside the sandbox: `git init`, `git fetch ../in.bundle refs/remotes/origin/main:refs/remotes/origin/main`, then `git switch -c factory/<job> origin/main`. A fetch into `refs/heads/main` fails, because git will not fetch into the checked-out branch.
  2. After the worker, a second `srt` call runs the repo's setup and checks in `work/`.
  3. A third runs `git bundle create ../out.bundle factory/<job>`.
  4. aleph fetches that branch into a worktree of the product repo under `~/.aleph/work/<job>`, outside `~/aleph`, and lands from there. A bundle fetch runs no code from the worker's repo.
- **Time box.** `RuntimeMaxSec` makes systemd stop the whole cgroup, including `setsid` children (probed with bwrap). The uid is Chris's, so `systemctl --user stop` and `aleph drop` still work.
- **Token.** It comes from `claude setup-token`, is stored in `~/.aleph/secrets/worker-token` (0600) and is passed into the sandbox's environment. It lasts one year and draws on Chris's subscription quota. Inside the sandbox it can reach only the allowed domains.
- **Probe.** `aleph sandbox probe` runs the checks of criterion 11 from inside the profile. It runs before the first run, and nightly from the timer.
- **Worker prompt.** It is rewritten for the sandbox: no `aleph todo`, no push, no rebase. Follow-ups go in the result. Questions are answered with the recommended default and printed as `DEFAULT: <question> -> <answer>`.

### Work store

- A private GitHub repo (`crsmithdev/aleph-items`), cloned at `~/.aleph/items`. One Backlog.md file per item (v1.55.3, `autoCommit` off), at `<repo>/backlog/tasks/<repo>-<n>.md`. Backlog.md takes one ID prefix per project, so each repo is its own project and has its own board: `backlog browser` in `~/.aleph/items/<repo>`. Built 27 Oct (`9e5c274`).
- Frontmatter carries every field `aleph todo` has today (number, title, status, priority, labels, created, updated, notes), plus `repo`, `parent` and `links`. The numbers stay per repo, so `aleph todo show aleph 28` keeps working.
- `aleph todo` keeps its commands and its write path: one commit on the store's `origin/main`, made without a working tree, retried when main moved. The sandbox cannot see the store. aleph files a worker's follow-ups from its result.
- The migration (`todo/migrate.ts`, run 27 Oct) moves every registry repo in one command; seven of the eight had a list, so no second write path exists. It removes each `docs/todo.md` in one commit per repo. It switches the land refusal and git-guard's `docs/todo.md` rule to the store path.

### Held paths

A list of globs per repo in `~/.aleph/repos.json`, which the sandbox cannot see. The list covers the factory's own gate, not every path that runs in Chris's sessions; for aleph, Chris's pull is the review. aleph's list:
- `jobs/**`;
- `hooks/hooks.json`, `hooks/verify-gate.ts`, `hooks/lib/judge.ts`, `hooks/lib/digest.ts`, `hooks/git-guard.ts`;
- `identity/CLAUDE.md`;
- `package.json`, `bunfig.toml`, `tsconfig.json`, `bun.lock`.

Plus the test rule in criterion 19. A run that only adds to an existing test file passes, also under a held path (Chris, 27 Oct: nearly every goal adds to a test file, so the old rule held nearly every run). aleph computes the diff in Chris's session from the fetched branch against its merge-base with `origin/main`. The seed works on aleph only, so the other repos get no list yet.

### Report

`aleph report` reads the ledger and prints the runs whose `shown` is false, then sets it. `told` stays Sidetone's flag, and `aleph jobs --news` keeps it. The SessionStart hook calls `aleph report` and adds two lines: how far `~/aleph` is behind `origin/main`, with the diff stat, and the health line.

### Budget and defaults

| Setting | Default | Basis |
|---|---|---|
| Runs in any 24 hours | 12 | Twelve 40-minute runs fill a night |
| Live runs | `CAP = 5` | Existing; shared with Chris's jobs |
| Time box | 40 min | `ALEPH_JOB_TIMEOUT`, 2400 s today |
| Timer | 30 min | None; a guess to tune |
| Check slots | 2 | `ALEPH_CHECK_SLOTS`. At most this many check runs of the test suite run at once across the factory (agent-run checks, land checks, rechecks, baselines), under locks `check-slot-<n>`. A check with no free slot waits; the wait does not fail it and does not count against `ALEPH_CHECK_TIMEOUT`. |
| Test workers per suite | cores / slots (12 on 24 cores) | `ALEPH_TEST_PARALLEL`, set by the factory for checks and in the worker sandbox env. The `test` script in package.json runs `bun test --parallel=${ALEPH_TEST_PARALLEL:-$(nproc)}`, so a plain `bun run test` by Chris keeps the full core count. |
| Run priority | `CPUWeight=20`, `--nice=10` | Every run unit (`systemd-run` for agent runs, lands, pulled lands and review2) gets both, so the shell, `aleph-ui` and Claude Code sessions win when the cores are busy. The `aleph-ui` unit and the tick keep the default weight. |

Check runs and probe runs do not count against the 12. They start no `claude`.

### Milestone 2 decisions

- **Land queue.** One drainer per repo. It is started by each run that becomes ready and by each timer tick, and held by a lock. It takes ready branches in order and merges each with `git merge-tree --write-tree` onto `origin/main`. It checks the merged tree in a sandbox, then commits and pushes it with a plain push. A refused push merges again. The queue keeps `BOUNCES` and `RELANDS` and records each entry's state, so a crash after the push does not re-merge.
- **Item state.** Derived from the store, the `origin/main` trailers, the ledger and the queue. The precedence is dropped, done, needs-you, stuck, running, open. Only lines in the trailer block count, and a revert of the commit undoes done. Items done before milestone 2, which have no trailer, keep the store's done. Nothing writes the derived state back to the store.

### Safe default actions for stuck and failed runs (28 Oct)

Chris, 28 Oct: a stuck or failed run gets a default action when the action is safe, so the factory does not wait hours for a person. Every dispatch (`rescueStuck` in `jobs/lib/factory.ts`, before the hold is read) takes it, and writes the reason to the run, the issue note and the news:

1. No commit, and the item is done or its work is on main (its `Job:` trailer): drop the run, as a duplicate. A work-on-main item is closed.
2. No commit, item open, first time: drop it and let the goal rerun once; the rerun's spec ends with a note that the last run made no commit and the last 20 lines of its `result.md`.
3. Time box, first time: the same, with the time box note.
4. Failed with an infrastructure reason (`job lock busy`, `fetch failed`, `systemd-run failed`, `worktree gone`, `bundle failed`): recheck an agent run whose branch exists, land a land run again, once. An agent run with no branch is dropped for one rerun.
5. Failed checks after a land merge, first time: drop it and rerun the goal on the new main, once, with the last 20 lines of the land's `checks.log`.

Anything else, or the second time one case hits one goal (the run folder's `rescued` file names the case), labels the issue `needs-chris` with a one-line question (also a note and a news line). The run keeps its state, with a `needs-chris` file in its folder, and **does not hold the factory**: other goals keep running, and the goal itself starts no new run until Chris drops or rechecks it. `aleph drop <name> <reason> --quiet` is the dispatch's drop (no note, no dispatch of its own). The pending rerun note is `~/.aleph/factory/rerun/<name>.md`, read once by the goal's start.

### What dispatches at once, and what only the tick starts (28 Oct)

The tick (`aleph-tick.timer`, every 5 minutes) only starts periodic or scheduled work. Every other transition starts the next step at once, with no wait for the tick: `aleph dispatch` runs in the same process call (a run's end) or detached (`dispatchDetached` in `jobs/lib/factory.ts`, which never fails or holds the caller). `ALEPH_DISPATCH=off` turns the at-once dispatches off, for tests; the tick still dispatches.

Dispatch at once:
- A run's end, of any kind but `plain`: the unit runs `aleph dispatch`. This covers a land that lands (the goals with `waiting_on: <repo>-<n>` on that job start), a baseline that turns green after a red main whose fix landed, and a cap that frees (live cap, waiting cap) when a run ends or leaves `needs-you`.
- `aleph issue add`, and `aleph issue edit` of an open goal: adding the `goal` label, removing `waiting_on` (`--waiting-on none`), or setting the status back to open (`--status open`). The UI's `POST /api/issues` runs `aleph issue add`, so the issue form dispatches the same way.
- A new issue that is not a goal, and a note that answers `needs-chris`: triage (`triageDetached`). A triage run that ends with a `goal` verdict dispatches, from `aleph triage` and from the tick's triage step.
- `aleph drop` of a job (frees a live slot, a waiting slot, or the hold), `aleph recheck` (the recheck is live, so the hold no longer counts), and `aleph checked`.
- `aleph resume`.

Only the tick starts:
- A due date that arrives: an item with `due` after today starts nothing until a tick on or after that date.
- The nightly sandbox probe, and the dependency sweep that follows a passing probe.
- The baseline of a main that moved without a land (a push by hand): nothing in the factory sees it until the tick's dispatch checks the new commit.
- The tick's triage of open issues that nothing triaged at once (a gated or failed triage), and a `waiting_on` whose target became done by a push by hand.
- The fallback dispatch for anything the above missed.

### As built (27 Oct)

Where the code departs from the sections above:

- **The land is milestone 2's.** Milestone 1 was to keep the rebase land and milestone 2 to replace it. The land was written once, in milestone 2's form: a merge in memory with `git merge-tree`, the checks on that tree, and a plain push of exactly that tree; a refused push merges again in the same land run, at most `RELANDS` times. It serves every repo. A repo outside the factory checks the tree in the job's worktree; a factory repo checks it under `srt`.
- **No worktree for a factory run.** aleph fetches `factory/<name>` from `out.bundle` into the repo's refs, and the land reads it from there. `~/.aleph/work/` is not used.
- **The checks run on a fresh clone of the out-bundle**, in `check/`, in their own `srt` call, so nothing the worker left in `work/` runs. Their output goes to `checklog/`, which only that call can write.
- **Stuck covers every failed factory run**: the result line, no commit, a failed check, the time box. The timer skips any goal with an open job, so a failed run is never retried by itself.
- **The held rule runs after the checks.** A run whose checks fail is stuck, not held.
- **A failed probe starts no run**, and the health line names it.
- **The report shows runs made after the report existed.** New runs carry `shown: false`; the 78 older runs have no `shown` and never appear.
- **`~/.aleph` inside the sandbox** shows the empty mount points `srt` makes for the run's own paths (`runs/<id>/`, `tools/lib`). No file under it can be read; the probe reads `secrets/`, `jobs/`, `items/` and `vault/`.
- **The tailnet probe uses port 80**, which answers the host; port 3010 does not, so it proved nothing.
- **`FOLLOWUP: <title>`** lines in a result become items labelled `followup`.
- **Milestone 2's queue has no drainer process.** Each land is still its own run in its own unit. It waits, under the repo's land lock, until no older live land of the repo is left, where older means an earlier `made`: the time in milliseconds at which the run was made, under the dispatch lock. Folder names sort by name within a second, so they could not order it. A crash after the push is safe because the land first looks on `origin/main` for its own `Job:` trailer.
- **`aleph status <repo>-<n>`** derives the state. Inside a sandbox there is no store and no ledger, so a factory run's bundle carries a snapshot of both for its repo, a commit at `refs/aleph/facts`, and `aleph status` reads it there when the registry does not have the repo.

### Rejected alternatives

- **A fixed second Unix user with a sudo wrapper.** The time box cannot kill across the uid. One home serves every run. Checks still ran as Chris. `/run/WSL` and `/mnt/c` are open to every uid.
- **systemd `DynamicUser`.** It needs root files and copies of the tools. It must still hide `/mnt` and `/run/WSL`, and `IPAddressDeny` does nothing in user units here.
- **Docker per run.** Containers sit outside the unit's cgroup, an image is needed per `claude` version, and a default container reaches host services.
- **SHA releases and a `live` link.** Two copies of aleph confuse Claude, nothing tests a hook before deploy, hand lands never deploy, and rollback runs through the broken release.
- **The work store in each product repo.** Branches can edit their own item, and every state write moves main.
- **`--force-with-lease`.** It accepts a non-fast-forward push.
- **A status projector.** It moves main and races the land.
- **A share-of-weekly-quota cap.** No code can read the quota.

## Testing Decisions

A good test drives a command and checks what git, the store, the ledger or the report show afterwards. Tests use real git in temporary repos, a fake worker (`ALEPH_WORKER_CMD`) that writes a `stream-json` transcript and a commit, and checks that are shell commands. Unit tests replace `srt` with a pass-through (`ALEPH_SANDBOX_CMD`), so they test the flow, not the isolation; the isolation has its own live seam.

The seams for milestone 1:

1. **The run, through `aleph job` with a fake worker.**
   - Cases:
     - a passing run lands with both trailers, `~/aleph` and its worktrees are unchanged, and `docs/todo.md` is in no commit;
     - an `is_error` result, a missing result, a stderr line after the result, or no commit ends stuck;
     - a held path needs Chris, and so does an existing-test edit;
     - a held-path change on the branch does not change the verdict;
     - `aleph land` on a needs-you run adds `Held-by: Chris`;
     - a stuck goal is skipped by the timer;
     - pause stops the timer but not Chris's land;
     - the 24-hour cap stops the timer;
     - `DEFAULT:` lines and costs reach `aleph report`, and `shown` is set apart from `told`.
   - Prior art: `jobs/cli.test.ts` (land, the state rule, a job tied to a to-do item, fate from git).
2. **The work store, through `aleph todo`.** Writes go to the store and not to a product repo. Every `list` and `show` output is unchanged by the migration. Prior art: `todo/cli.test.ts`.
3. **The sandbox, live, in `tests/live`.** `aleph sandbox probe` (criterion 11), the empty home and the removed run folder (12), the time box with a `setsid` child (13), and the environment (14).
4. **The proofs, live, in `tests/live`.** To-do 28 and to-do 27 each go through `/aleph:goal` again, so they get the `goal` label and the four sections, then run for real. Their transcripts are graded for the skill's criteria 1-5.

Milestone 2 adds one seam: the queue on real git, with three branches, an overlap, main moving during a land, and a crash after the push.

## Out of Scope

- A deploy split, or any second copy of aleph.
- The reviewer, the baseline on main and the report's time estimates. These are later factory goals.
- Concurrency beyond `CAP`, and batched or speculative merges.
- Decomposing a goal into tasks. The `parent` field exists for later.
- Running while the machine sleeps, and cloud scheduled tasks.
- Model routing, non-code goals and the UI.
- Episodic memory and lesson promotion. Workers read no vault.
- Web fetch inside the sandbox.
- Langfuse traces of worker runs. The cost comes from the `result` event.
- Held lists for repos other than aleph.

## Open Questions

- **`srt` on this machine.** A probe by hand on 27 Oct (to-do 32) answered all four questions:
  - kill: `RuntimeMaxSec` ends the unit with `Result=timeout`, and a `setsid` child stops with it;
  - WSL interop: `/run/WSL`, `cmd.exe` and writes to `/mnt/c` are all denied;
  - `bun test`: aleph's suite passes inside the sandbox (167 pass, 9 skip, 0 fail), after `bun install` through the proxy.

  - the token alone: `claude -p "say ok"` with only `CLAUDE_CODE_OAUTH_TOKEN` and the allowed domains ends with a `result` event, `is_error` false (cost $0.0016). It needs no `platform.claude.com`, and it makes no auto memory folder.

  A probe must use `curl -f`, because the proxy answers a denied host with HTTP 403.
- **Token revocation.** How to revoke a `setup-token` token before its year is unverified.
- **WSL idle shutdown.** Whether WSL stops the VM, and every user unit with it, when no Windows client is attached is unchecked. A night with the timer and the health line answers it.
- **Proof sample size.** One run each of to-dos 28 and 27 shows that the path works. It does not measure a rate. A rate needs the factory's first ten goals.

## Further Notes

Background material:

- **Memory:** `~/.aleph/reports/Shared memory across factory agents.md`. The seed takes two of its findings. Workers start from the item, the repo's `CLAUDE.md` and `git log`, with auto memory off. A check the worker cannot edit decides success.
- **Work store:** `~/.aleph/research_notes/Self hosted work store/notes.md`.
- **Landing:** `~/.aleph/research_notes/Landing agent changes/notes.md`.
- **Sandboxing:** `~/.aleph/research_notes/Local agent sandboxing/notes.md`, with the probes run on this machine.
- **References:** `~/.aleph/research_notes/Seed factory references/notes.md`, corrected by the runtime lens (`~/.aleph/handoffs/red-team/seed-decisions-round1-runtime.md`). What the seed takes from them:
  - from autoresearch, a judge the worker cannot edit, a time box per attempt and an append-only ledger;
  - for milestone 2, the Bun port's rule that the tested tree is the pushed tree;
  - for later goals, the Bun port's diff-only reviewer;
  - from Anthropic, stages kept simple and in code, with capped iterations.

  The references:
  1. A. Karpathy, "autoresearch", GitHub, March 2026.
  2. A. Karpathy, "AgentHub", GitHub, March 2026 (read through a preserved fork).
  3. A. Karpathy, "From Vibe Coding to Agentic Engineering", Sequoia AI Ascent, April 2026 (third-party transcript).
  4. A. Karpathy, post on collaborative agent swarms, 8 March 2026.
  5. E. Schluntz and B. Zhang, "Building Effective Agents", Anthropic Engineering, December 2024.
  6. Anthropic, "Dynamic Workflows", Claude Code, May 2026.
  7. Anthropic, Knowledge Graph Construction Cookbook, claude-cookbooks (partly read).
  8. L. Martin, G. Cemaj, M. Cohen, "Scaling Managed Agents", Anthropic Engineering, April 2026.
  9. A. Karpathy, "Software 3.0, Agentic Engineering, and Jagged Intelligence", 30 April 2026.
  10. Fortune, "Why everyone is talking about Karpathy's autonomous AI research agent", 17 March 2026.
  11. Anthropic, "Building Effective AI Agents: Architecture Patterns", 2026 (behind a form; not used).
  12. J. Sumner, Bun Zig-to-Rust port using Dynamic Workflows, May 2026.
