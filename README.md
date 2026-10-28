# aleph

A personal [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin. Skills for planning, design, testing and memory; hooks that trace every turn to a local [Langfuse](https://langfuse.com), guard `main`, scan commits for secrets and judge whether a turn verified what it claims; and an Obsidian vault the agent writes and a human reads.

Everything runs on [Bun](https://bun.sh). Langfuse is optional and self-hosted.

## Layout

| Path | Holds |
|---|---|
| `skills/` | the skills, invoked as `/aleph:<name>` |
| `jobs/` | `aleph`: agent jobs, the land, the issue CLI and the factory (`jobs/lib/sandbox.ts`, `gate.ts`, `factory.ts`); the tick's systemd units |
| `hooks/` | the hook scripts and `hooks.json`, against the 2.1.x hook API |
| `vault/cli.ts` | the memory vault's mechanics (each write op commits and pushes): `init`, `write`, `adopt`, `recall`, `lint [--fix]`, `consolidate`, `rename-scope`, `archive`, `compile`, `misses [--days N]` (read-only: recall misses from Langfuse) |
| `identity/CLAUDE.md` | the global `CLAUDE.md` the hooks assume: the worktree rule, the verification rule, the voice |
| `compose/langfuse.yml` | self-hosted Langfuse on `127.0.0.1:3010` |
| `docs/` | the verify-gate and context-gate decision records, and the vault spec |
| `tests/live/` | tests against a running Langfuse and real headless sessions |

## Skills

| Skill | Does |
|---|---|
| `grill-me` | Interviews you about a plan until shared understanding. Maps the plan as a design tree and asks the whole open frontier each round, with a recommended answer per question |
| `grill-with-docs` † | `grill-me` that also writes `CONTEXT.md` and ADRs as terms and decisions settle |
| `red-team` | Parallel subagents review a plan, RFC or PR description against the code it touches; report by fatal, defects, smells, cheaper alternatives |
| `prior-art` | Surveys the open-source field against a repo you own: axes drawn from its architecture, finalists read at the code level, a ranked list of what to take and what to skip |
| `to-spec` | Turns the conversation into a spec file. No interview |
| `tdd` | Red → green, with tests only at seams agreed up front |
| `diagnosing-bugs` | Reproduce, minimise, rank several hypotheses, then fix |
| `codebase-design` | Vocabulary and principles for deep modules: module, interface, seam, adapter, the deletion test |
| `domain-modeling` | Builds the project glossary (`CONTEXT.md`) and records ADRs |
| `improve-codebase-architecture` † | Scans a codebase for deepening candidates, presents them as an HTML report, grills through the one you pick |
| `docs-writing` | Writes and audits docs with Diátaxis type gating and 51 rules |
| `blog-writing` | Writes and reviews blog posts and essays, technical and general: structure, sentence and AI-pattern passes, then `humanizer` |
| `humanizer` | Rewrites prose so it does not read as AI-written: blog posts, essays, anything for people rather than agents |
| `writing-for-agents` | How to write a skill, an `AGENTS.md` or a `CLAUDE.md` |
| `vault` | Reads and writes the memory vault |
| `handoff` / `pickup` | Saves a session to `~/.aleph/handoffs/current.md` (or `<name>.md` when given a name); resumes it in a fresh context |
| `retro` † | Reads the session's trace and transcript; proposes fixes to identity, skills, hooks and vault |
| `goal` | A short product-level grill that writes one `goal` item for the factory: goal, edit surface, oracle, time box |

† user-invoked only: the model cannot fire it on its own.

## Hooks

| Event | Hook | Does |
|---|---|---|
| every event | `obs.ts` | posts one OTLP span per hook event to Langfuse; async except `Stop` and `SessionEnd` |
| `SessionStart` | `vault-context.ts` | injects the vault's `Home.md` and `MEMORY.md` |
| `SessionStart` | `aleph report --hook` | the factory runs not yet shown, how far each factory repo's checkout is behind `origin/main`, and the health line |
| `UserPromptSubmit` | `vault-recall.ts` | Jev picks up to 3 `wiki/` notes that bear on the prompt (title or alias shares a content word; p ≥ 0.7) and injects title, path and claim line. Silent under `aleph judge haiku`, on a Jev error or a prompt under 20 chars |
| `UserPromptSubmit`, `Stop` | `verify-gate.ts` | snapshots the tree, then judges the final message: every claim of completion must trace to a run after the last edit. Denies with a reason, at most twice per prompt. `docs/verify-gate.md` |
| `Stop` | `context-gate.ts` | reads the session's context fill from the transcript: warns Chris above 0.75 of the compaction threshold, blocks once the session has compacted and asks for a handoff. `docs/context-gate.md` |
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

## Issues

Every repo in `~/.aleph/repos.json` has a list in the work store, a private git repo cloned at `~/.aleph/items` (`$ALEPH_ITEMS`). Each item is one file, `<repo>/backlog/tasks/<repo>-<n>.md`: a small frontmatter header, free prose, and a Notes list. **Status is a field, never a filing position** — a finished item stays where it is and keeps its number, because commits, specs and the vault quote that number.

```bash
aleph issue add <repo> "<title>" [--body -] [--priority high] [--labels a,b]
aleph issue list [<repo>] [--status open|done|dropped] [--label <name>] [--json]
aleph issue show <repo> <id> [--json]
aleph issue edit <repo> <id> [--title "<title>"] [--body -] [--priority p] [--labels a,b]
aleph issue note <repo> <id> "<text>"      # appends one timestamped line, never rewrites
aleph issue done <repo> <id> ["<summary>"]
aleph issue drop <repo> <id> "<reason>"
aleph issue lint [<repo>] [--fix]
```

With no repo, `list` and `lint` cover the recent repos: those with a ledger run or an item update in the last 7 days, the latest first.

The store's `origin/main` is the record. A read fetches and reads it there; a write is one commit on it, made without a working tree, and the store's checkout fast-forwards. No product repo's main moves when an item changes. A job's item closes in the store after the job's landing commit is pushed. git-guard denies an Edit or Write on a store file. Each `<repo>/` folder is a Backlog.md project (pinned 1.55.3 in `~/.aleph/tools`), so `backlog browser` in `~/.aleph/items/<repo>` shows that repo's items as a board. Make changes with `aleph issue`, not the board.

Each item carries `id title status created updated priority labels repo`. `note` is append-only, which is the lost update this format exists to stop: two writers add lines, neither erases the other's. `lint` refuses (exit 1) on a missing or malformed key, an unknown status, or a duplicate id; `--fix` repairs what is mechanical — a missing date, a stale `id`, a bare scalar where a list belongs — and still exits 1 if anything is left.

## Factory

A repo with `"sandbox": true` in `~/.aleph/repos.json` is a factory repo (today: aleph). `/aleph:goal` writes an open issue labelled `goal`; a dispatch (`aleph dispatch`) starts a run for each such item that is ready, up to the live cap. It runs when a run ends, when a goal is added or edited with `aleph issue`, and from the `aleph-tick` timer (every 5 minutes) as a fallback; the timer also does the periodic work. Each start holds a lock on its goal, so two dispatches at once start it once. After it starts those, the tick triages open issues that are not goals, oldest first, at most 5 a tick (`ALEPH_TRIAGE_CAP`) and only while live runs are below the live cap: one read-only `claude -p` run per issue (`ALEPH_TRIAGE_CMD` replaces the command) gives a verdict, which the tick applies through the work store. `goal` rewrites the body in the goal format and adds the `goal` label; `close` marks it done with the reason as a note; `chris` adds `needs-chris` and a note with one question; `live` adds `live-check` and `triaged` and a note. Items labelled `needs-chris`, `triaged`, `proposal` or `goal`, or waiting on an item that is not done, are skipped. A triage is a ledger job of kind `triage` and counts toward the day cap; a malformed verdict or a failed run leaves the item unchanged and shows in the tick's skipped list, until the item has had `ALEPH_TRIAGE_TRIES` (default 2) such runs: then it gets `needs-chris` and a note, and later ticks skip it. The tick's log line gives the count per verdict. Triage is also continuous: `aleph issue add` of a non-goal issue in a factory repo, a note that is not a worker's or the factory's on a `needs-chris` issue (it removes the label; the prompt includes all notes, so the note is the answer), and a worker's `FOLLOWUP:` issue each start `aleph triage <repo>-<n>` detached, under the dispatch's gates (paused, the hold, a failed probe, the day cap, the live cap); a gated issue waits for the tick, which stays as the fallback. Spec: `docs/specs/2026-10-26-seed-factory.md`.

- **The run.** The worker is `claude -p` under `srt` (`~/.aleph/tools/bin/srt`), in `~/.aleph/runs/<id>/`. It sees an empty home, the code as a bundle of `origin/main` (and the job's previous `factory/<name>` branch), and the network only to `api.anthropic.com` and npm. Its environment holds the token in `~/.aleph/secrets/worker-token` and nothing else of yours. A second `srt` call bundles the branch, aleph fetches it into the repo as `factory/<name>`, and a third runs the repo's setup and checks on a fresh clone. The run folder goes when the verdict is known.
- **The gate.** A run is stuck when the last line of the worker's output is not a `result` event with `is_error` false, when it made no commit, when a check fails, or at the time box (`ALEPH_JOB_TIMEOUT`, 40 minutes). A worker whose output file grows by no byte for `ALEPH_STALL_SECONDS` (default 600) is stopped like the time box and the run is stuck as `stalled: no output for 10 minutes`. A failed check (not the time box, a stall, an error result or no commit) sends the job back to its worker on the same branch, with a note that names the check and holds the last 80 lines of its log, at most `ALEPH_FIX_ROUNDS` times a job (default 2); each round is a run for the day cap, and after the last the run stays stuck as `<check> failed after <n> fix rounds`. A run that passes after fix rounds says so in the report. A diff that touches a path in the repo's `held` list (test files apart) needs you. A diff that deletes or renames an existing test, removes or changes a `test`, `it`, `describe` or `expect` line, or adds `.skip`, `.only` or `.todo` does not hold the run: each such change goes to the reviewer as a finding in its prompt ("The diff deletes the test ui/list.test.ts"), and the reviewer holds only when the goal does not call for it or it weakens a check the goal keeps. A diff that only adds to a test file gives no finding. When the checks pass and no rule holds, a fresh reviewer (`claude -p`, `claude-opus-5-5`, under srt with the worker's profile, in a clone of the branch) reads the item and the diff (a diff over `ALEPH_REVIEW_DIFF_MAX` characters, default 200000, goes in as the `git diff --stat`, the diff cut at that length and a line that says so) and ends with `VERDICT: pass` or `VERDICT: hold <reason>`; a hold, no verdict, an error or the time box (`ALEPH_REVIEW_TIMEOUT`, 10 minutes) needs you (`needs: review`), and its cost is added to the run's. For the held and the reviewed, `aleph land <name>` lands it with `Held-by: Chris`, `aleph drop <name>` drops it.

- **Hidden checks.** A goal item can have test files the worker never sees, kept in the work store at `<repo>/hidden/<n>/`. `aleph todo hidden <repo> <n> <file>...` copies files in as one commit, `aleph todo hidden <repo> <n>` lists them, and `aleph todo show` prints `hidden checks: <count>`. In a factory run's check phase, once the repo's checks pass, aleph copies the item's files into the fresh check clone as `.hidden/` and runs one more check, `hidden`, with the registry entry's `hiddenRun` (default `bun test ./.hidden`). The land's checks run it again on the merged tree. A failure is `hidden check failed: <k> of <n> tests`; the log goes to `hidden.log` in the run folder, and a fix round's note gets that line and the names of the failing tests, never the source or the log. The report and `/api/state` show `hidden <passed>/<total>`.
- **The land.** Lands of one repo go one at a time, in the order they became ready. Each merges the branch onto `origin/main` in memory (`git merge-tree`), runs the checks on that tree, and pushes exactly that tree as one squash commit with a plain push; a refused push merges again. **A batch.** The land that takes the lock also takes the land runs queued behind it, and starts `aleph land` for passed runs that wait to land by themselves (not while paused or held), up to `ALEPH_LAND_BATCH` runs (default 8). It merges them onto `origin/main` in order, one squash commit each with its own trailers, runs the checks once on the last commit and pushes all the commits in one push. If the checks fail it splits the batch in half and checks each half until it finds the run that fails; that run fails with the check's name and the others land. A merge conflict takes only that run out, with `merge conflict` and the file names. The held rule, the reviewer and the hidden checks ran before the land and apply as for a single land. **Skipped checks.** An agent run records `checkedBase`, the `origin/main` its checks passed on. When `origin/main` is still there at the land, the land pushes without the checks and land.log says `checks skipped: main unchanged since <sha>`. The commit ends with `Item: <repo>-<n>` and `Job: <job>`. After the push the land fast-forwards the repo's main checkout if it is clean and on the main branch (land.log says why not otherwise), and on a `ui/` change in aleph restarts aleph-ui.
- **The hold.** The factory holds itself while any open job in a factory repo is `stuck` or `failed` (an agent run, or a land that hit a merge conflict or a failing test). Dispatch and tick start no run, goal or triage; a run that passes waits as `passed` and does not land by itself; runs already working finish. `aleph land <name>` still works, so the stuck run can be fixed and landed. The hold clears when no job is stuck or failed (landed, rechecked, dropped); the next dispatch then starts runs and lands the waiting passed runs, oldest first. It is separate from `aleph pause`. The Now banner, `aleph report`, and the dispatch and tick output give the line `Held: aleph-116 is stuck (merge conflict). No run starts or lands until it is cleared.`
- **Re-check.** `aleph recheck <name>` is the way out of a stuck or failed run that keeps its work, such as one a flaky test on main stuck. The job must be open, its last run an agent or recheck run that is `stuck` or `failed`, in a factory repo, with its branch still there; otherwise it refuses with the reason. It starts a run of kind `recheck`, with no worker: the run merges the current origin main into the branch (a conflict makes the run stuck as `merge conflict: <files>`), runs the checks in the sandbox, the held rule and the reviewer, and ends `passed`, `needs-you` or `stuck`. A passed recheck lands as a passed agent run does. On the Now page a Stuck card has a Re-check button (`POST /api/recheck/<name>`) and a Drop button.
- **The switches.** `aleph pause` and `aleph resume` (`~/.aleph/factory/paused`); 12 runs in any 24 hours (`ALEPH_DAY_CAP`) and 10 live at once (`ALEPH_LIVE_CAP`); no new run while 5 runs wait for Chris (`ALEPH_WAITING_CAP`, `needs-you` only). Each cap is read from its variable first, then from `~/.aleph/factory/caps.json` (`{ "day": 999, "live": 12, "waiting": 5 }`), then the default; a missing or bad file gives the defaults, so `aleph report` and `aleph-ui` show what the timer uses; `aleph sandbox probe` checks the isolation, nightly from the tick, and a failed probe starts no run. While a repo's checks fail on `origin/main` (run once per commit, kept in `~/.aleph/factory/baseline.json`), the tick starts no run there and the report says `main is red`. One baseline runs per repo at a time, under a lock: a dispatch that finds it taken starts nothing there and says `main baseline running`. Only a failed check is recorded as red; an error that kept the checks from running (`checks did not start`, `bundle failed`) is reported as `main is unchecked` and tried again by the next dispatch. `aleph report` prints what is new. With the nightly probe the tick also runs `bun outdated` (`ALEPH_OUTDATED_CMD` replaces it in tests) in a fresh clone of each factory repo's `origin/main`, inside the sandbox, and files one item per package whose latest is newer than the lockfile's: `Update <package> <current> to <latest>`, labels `proposal,deps`, never `goal`, so nothing starts until Chris relabels it. A package and version already proposed is not proposed again (`~/.aleph/factory/deps.json`); the report lists the new ones once. A check that fails in a run's checks, a land's or the baseline runs once more on the same tree (not on a timeout, not the hidden check): if it passes, it counts as passed, the flake goes to `~/.aleph/factory/flaky.json` (repo, check, run id, time), the run's report entry says `<check> passed on rerun`, and two flakes of one check in 7 days raise `health: <repo> check <name> passed on rerun <n> times in 7 days`. A second failure is a real failure, with fix rounds as before.
- **The trace.** After each factory run, with `LANGFUSE_*` set, the unit posts the worker's stream-json (and the reviewer's) to Langfuse as one trace named `factory <job>`, session id the job id, one span per tool call (`jobs/lib/trace.ts`); a failed post is a line in `trace.log` in the run folder and changes nothing else.

```bash
systemctl --user link ~/aleph/jobs/systemd/aleph-tick.service
systemctl --user enable --now ~/aleph/jobs/systemd/aleph-tick.timer
aleph sandbox probe          # criterion 11, from inside the profile
aleph report                 # runs not yet shown, behind count, health
aleph status aleph-28        # done from an Item: trailer on origin/main, else the store, the job, open
aleph status                 # the same for each open item in the recent repos
aleph jobs                   # open jobs, then the jobs that ended in the last 24 hours
aleph pause | aleph resume
```

## UI

`aleph-ui [--port <n>]` serves the factory UI on `127.0.0.1` only (default `ALEPH_UI_PORT` or 3020) and prints the URL. `GET /` is `ui/index.html`: a sidebar in four groups (Factory, Work, Activity, Memory), hash routes (`#/jobs/aleph-52`), and a project picker whose choice rides along as `?project=<key>` on every route and every `/api` fetch. `GET /api/state` is the JSON of `docs/specs/2026-10-27-ui.md`, read from the ledger, the factory directory and the work store, narrowed by `?project=`; it writes nothing. `GET /api/projects/keys` lists the registry's repos, `GET /api/views` the files under `ui/views/`.

To add a view, add two files and touch no shared one:

- `ui/views/<view>.js` exports `view = { path, title, group, order, api, refresh, render(data, params) }`. `path` is the hash route, with `:params` (`/jobs/:name`); a path with a param stays out of the sidebar. `group` is `factory`, `work`, `activity` or `memory`; `order` sorts within it. `api` is the URL the page fetches, with the route's `:params` filled in (or a function of `params`); `refresh` is seconds between reloads, if any. `render` returns HTML; import `esc`, `md`, `clock`, `money`, `span`, `empty`, `error` and `cmd` from `../lib.js`, and add to `ui/lib.js` without changing what is there.
- `ui/api/<view>.ts` exports `routes`, a map from `"GET /api/jobs/:name"` to `(req, params, url) => Response`. Honour `url.searchParams.get("project")`. The server loads every `ui/api/*.ts` at start, so restart `aleph-ui` after adding one.

## Development

```bash
bun test                          # hooks and the vault CLI, with a mock Langfuse
ALEPH_LIVE=1 bun test tests/live  # posts a span and fetches the trace back; headless sessions through the vault; the factory sandbox
```

A 200 on the OTLP POST proves nothing, because the worker can drop a batch silently (`compose/README.md`). The live test asserts the trace is retrievable. CI runs the typecheck and the unit suite on every push.

## Credits

`tdd`, `diagnosing-bugs`, `retro`, `writing-for-agents`, `codebase-design`, `domain-modeling`, `grill-with-docs` and `improve-codebase-architecture` are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, `skills/LICENSE-mattpocock`). The first four drop its `CONTEXT.md`, ADR and issue-tracker conventions; the last four keep them, because those files are what the skills produce. `docs-writing` is adapted from [mblode/agent-skills](https://github.com/mblode/agent-skills) (MIT, `skills/LICENSE-mblode`), without its sibling-skill references and eval suite. `humanizer` is [blader/humanizer](https://github.com/blader/humanizer) 3.1.0 at `8c307f3` (MIT, `skills/LICENSE-humanizer`), SKILL.md only, unmodified. `blog-writing` is adapted from [getsentry/skills](https://github.com/getsentry/skills) `blog-writing-guide` at `f57ada2` (Apache-2.0, `skills/LICENSE-sentry`), changed: Sentry's voice, SEO, bylines and post types removed, a section on mixed readers and the pass order added. It also takes the AI-pattern list and Strunk's chapters 3 and 5 from [softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit) `writing-clearly-and-concisely` at `3027f20` (MIT, `skills/LICENSE-agent-toolkit`); Strunk's 1918 text is public domain. `skills/blog-writing/signs-of-ai-writing.md` is [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) by Wikipedia contributors, CC BY-SA 4.0, unmodified.
