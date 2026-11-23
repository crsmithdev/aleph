# Hooks

Aleph registers its hooks in `hooks/hooks.json`. `.claude-plugin/plugin.json` points to that file. Each hook is `bun <script>` against the Claude Code 2.1 hook API. Every script in `hooks/*.ts` is registered. The modules in `hooks/lib/` are helpers, not hooks.

After you change a hook, run `/reload-plugins`.

## Hooks by event

| Event | Matcher | Script | Timeout (s) | Does |
|---|---|---|---|---|
| every event | | `obs.ts` | 5–10 | Sends spans to Langfuse |
| `SessionStart` | | `vault-context.ts` | 10 | Injects `MEMORY.md` and the `core:` lines |
| `SessionStart` | `startup\|clear` | `handoff-start.ts` | 10 | Injects a waiting handoff |
| `SessionStart` | | `cli/cli.ts report --hook` | 20 | Injects the factory report |
| `SessionStart` | | `cli/cli.ts help --brief` | 10 | Injects one line per `aleph` command, for factory agents too |
| `UserPromptSubmit` | | `verify-gate.ts` | 10 | Snapshots the repo for the Stop check |
| `UserPromptSubmit` | | `vault-recall.ts` | 5 | Injects up to 3 vault notes |
| `PreToolUse` | `Edit\|Write\|NotebookEdit` | `git-guard.ts` | 10 | Denies edits on `main`, in the items repo and on `VAULT.md` |
| `PreToolUse` | `Bash` | `secret-scan.ts` | 10 | Denies a commit that adds a secret or a debug leftover |
| `PreToolUse` | `Bash` | `gh-guard.ts` | 15 | Asks before a `gh` write to a repo of another owner |
| `PreToolUse` | `Bash` | `bash-allow.ts` | 10 | Denies a Bash command outside the run's own `Bash(...)` list |
| `PostToolUse` | `Write` | `handoff-saved.ts` | 10 | Ends the turn after a handoff file is written; in Herdr or its desktop app, also clears and picks up |
| `Stop` | | `verify-gate.ts` | 45 | Blocks a claim of completion that no run supports |
| `Stop` | | `context-gate.ts` | 10 | Warns on context fill; asks for a handoff after a compaction |
| `Stop` | | `skills/refit-code/hook.ts` | 20 | Blocks once per set of findings, at most 3 times per session, when a change leaves out a file that history changes with it, copies code a `.jscpd.json` boundary protects, or adds a copy of code the base did not have |

`obs.ts` runs async on every event except `Stop`, `StopFailure` and `SessionEnd`, where it runs inline with a 5-second timeout.

## Failure modes

The four `PreToolUse` guards **fail closed**. `hooks.json` wraps each in `sh -c 'bun "$1" || { …; exit 2; }'`, and each script also catches its own errors and exits 2. A guard that crashes denies the tool call.

All other hooks **fail open**. An error exits without a block, or prints nothing. Without Langfuse keys, `obs.ts` exits silently. Without a vault, `vault-context.ts` prints nothing.

## Context hooks

### vault-context

`hooks/vault-context.ts` injects `additionalContext`: the vault's `MEMORY.md`, then the `core:` lines of the repo's scope and of `global`. `startContext` in `vault/lib/vault.ts` cuts the text to a byte budget. Its opening tag gives the text's bytes and the budget, as in `<vault path="…" bytes="5967" budget="6000">`. The hook is silent when `<vault>/VAULT.md` does not exist. `ALEPH_VAULT` sets the vault path (default `~/.aleph/vault`).

### handoff-start

`hooks/handoff-start.ts` looks for `<handoffs>/projects/<repo>.md`. Inside Herdr (`HERDR_ENV=1` and `HERDR_PANE_ID` set), it also looks for `<handoffs>/projects/<repo>/<HERDR_PANE_ID>.md`, and it never offers the file of another live pane. Inside the Herdr desktop app (`HC_TERMINAL_ID` set, no Herdr pane), it looks for `<handoffs>/projects/<repo>/hc-<HC_TERMINAL_ID>.md` instead and never offers a pane's file; it lists each other `hc-` file of that folder as orphaned when `hc get <terminal>` exits non-zero. Inside Herdr, an `hc-` file is never listed as orphaned. It lists each other file of that folder whose pane `herdr pane list` no longer shows as orphaned: Claude asks the user before it picks one up. When a file exists, the hook prints a `systemMessage` and tells Claude to run `aleph:pickup`. Inside Herdr, it passes the path of `<repo>.md` as the argument, because `aleph:pickup` with no argument reads the pane's file. When the handoff text, `git status` and `git log -5` fit in 10,000 characters, the hook injects them too. `ALEPH_HANDOFFS_DIR` sets the folder (default `~/.aleph/handoffs`). The hook does nothing in a factory run (`ALEPH_JOB_ID` set) or an SDK session.

### aleph report

`aleph report --hook` (`reportCmd` in `cli/commands.ts`) injects the lines `hookLines` in `jobs/lib/transitions/factory.ts` builds:

- `factory paused`, when the factory is paused;
- the count of the asks that wait for the user and the first 5 of their refs;
- a line for each red main (`redMains`);
- the stall health lines (`stallLines`);
- one line for each sandbox checkout that is behind `origin/main`.

It fetches `origin` only for the sandbox repos. It prints nothing when `ALEPH_AGENT` is set, or when it has no lines. The unshown runs, the flake lines and the monitor's line are only in plain `aleph report`, which marks the runs it shows as shown unless `--peek`; the hook marks none.

### vault-recall

`hooks/vault-recall.ts` skips prompts under 20 characters. It ranks the wiki notes (`rankNotes` in `vault/lib/index.ts`), leaves out core notes and the notes this session has already seen, and asks Jev one yes/no question for each of the top 100, 20 to a request in parallel, with a 1.5-second timeout. It injects at most 3 notes with p ≥ 0.85. It swallows every error. The judge choice `haiku` turns it off.

## Guards

### git-guard

`hooks/git-guard.ts` returns `permissionDecision: "deny"` for:

- an edit in the items repo (`itemsDir` in `lib/store.ts`); the reason says to use `aleph issue` or `aleph idea`;
- an edit of `VAULT.md` in the vault;
- an edit on `main`, `master` or a detached HEAD in a repo's main checkout.

Linked worktrees are allowed. Repos whose top level is `~`, `~/.claude` or `~/.aleph`, and files outside any repo, are exempt. The guard resolves symlinks first.

### secret-scan

`hooks/secret-scan.ts` acts only on a Bash command that runs `git … commit`. It scans the staged diff. With `-a`, `-A` or a `git add` in the command, it also scans the unstaged diff and the untracked files under 1 MB.

The rules in `hooks/lib/scan.ts` find AWS, Anthropic, Langfuse, OpenAI-style `sk-`, GitHub, Slack and Google keys, private keys, JWTs, a generic credential assignment of 16 or more characters, and the debug leftovers `debugger`, `pdb`, `pry` and `.only(`. A finding denies the commit. A `cd` or `-C` to a directory the guard cannot resolve also denies.

To skip the scan, put `ALEPH_SKIP_SCAN=1` in the command text.

### gh-guard

`hooks/gh-guard.ts` finds `gh` writes: a write verb (`gh pr create`, `gh issue comment`, …) or a `gh api` call with a non-GET method, `-f`/`-F` fields or a `mutation`. It finds the owner from `-R`/`--repo`, a github.com URL, `repos/<owner>/`, or the `origin` of the directory after each `cd`. When the owner is not the user, or the guard cannot find the owner, it returns `permissionDecision: "ask"`. The user is `ALEPH_GH_USER`, else `gh api user -q .login`: the login that command prints.

### bash-allow

`hooks/bash-allow.ts` acts only when `ALEPH_BASH_ALLOW` is set: a JSON array of command prefixes. `callAgent` in `jobs/lib/roles/agent-call.ts` sets it from the `Bash(<prefix>:*)` entries of a run's `--allowedTools`, so the maintainer, recheck, dedupe, alias, housekeeper and director runs get it. A run with no such entry, such as the worker or the reviewer, gets no variable, and the hook lets every command through. The hook exists because `~/.claude/settings.json` may allow plain Bash, which lets a command through that the run's list does not name.

With the variable set, the hook denies a command that is not a prefix or a prefix followed by a space and arguments. It denies a command that chains (`;`, `&&`, `||`), pipes, redirects, or substitutes (`` ` ``, `$`) outside single quotes, or has a newline, because those parts are not the prefix. Without it the hook prints nothing.

## Gates

### verify gate

`hooks/verify-gate.ts` runs twice per turn and hands the event to `gate()` in `hooks/lib/gate.ts`. At `UserPromptSubmit` it snapshots the repo and its worktrees into the spool (`hooks/lib/snapshot.ts`). At `Stop` it compares, and decides in this order:

1. No code file changed (`.md` and `.mdx` do not count): pass.
2. The prompt says `skip verify`: pass. Factory runs cannot use this.
3. The gate has denied twice this turn: pass.
4. Else the judge decides (see [Routing](routing.md#judge)).

A deny is `{decision: "block", reason: "Verify gate: …"}`. A judge that cannot answer passes the turn as `fail-open`. Each outcome posts a `guardrail` span and a `verified` score to Langfuse. The reason for each decision and the measurements are in [ADR 0003](adr/0003-verify-gate-judges-substance.md).

- **Rule.** Each claim of completion or correctness about code that the turn changed must trace to a run of the turn, after the last edit, whose output shows the result. An edit backs only a claim about the edit. A plain statement of what was not verified passes on that point. `RUBRIC` in `jobs/lib/roles/judge.ts` is the judge's prompt, and it lists the claims that are out of scope. The Verification section of `identity/CLAUDE.md` gives Claude the same rule.
- **Scope.** The gate runs on the main agent's `Stop` only: `SubagentStop` runs only `obs.ts`. In a factory agent (`ALEPH_AGENT` set) the gate does nothing.
- **Snapshot.** For the cwd repo and each worktree it lists, the snapshot holds `HEAD` and a hash of each dirty file: a file changed against `HEAD`, or untracked and not ignored. It leaves out the subagent worktrees under `.claude/worktrees/`, except the one that holds the cwd. The spool file is `snap:<prompt_id>.json`.
- **Changed files.** These are the dirty files whose hash differs, and the files in the commits that a `HEAD` gained and no earlier `HEAD` reaches. A change in a worktree that does not hold the cwd, the main checkout included, counts only when an edit path or a path in a Bash command of the turn lies in that worktree. A path resolves from the `cwd` of its transcript entry, else from the Stop cwd, with `~` and `$HOME` expanded. It belongs to the deepest worktree that holds it. Outside git, an edit tool call on a code file counts. The gate does not see a change in another repo.
- **Denials.** The count is per `prompt_id`, and the third `Stop` is a forced pass. A `Stop` that follows a deny (`stop_hook_active`) is judged as any other.
- **Digest.** `hooks/lib/digest.ts` reads the prompt's entries from the transcript: each edit (tool, file), each Bash command with the first and last 500 characters of its output, each other tool call with 200 characters of its result, and the final message. It keeps the last 12,000 characters of the tool calls. The final message is the Stop input's `last_assistant_message`, else the last text in the transcript.
- **Jev screen.** With the judge `jev`, Jev answers one `noul` question on the final message alone: does it claim that work is complete, fixed, working, passing, landed or verified? Below `ALEPH_JEV_PASS_BELOW` (0.05) the turn passes on Jev's answer. Each other turn, an empty final message and a Jev error go to Haiku, so only Haiku can deny, and each deny names its claim.
- **Budget.** The judge has 35 s in all, which ends 10 s before the hook's timeout. The Jev screen (at most 15 s), the GPU slot wait and each Haiku try use only the time left. When the budget is spent, the turn passes as `fail-open`. Haiku runs with `--effort low` and without the agent settings' effort `high`, so it does not think, and answers strict JSON: `{"verdict":"pass"|"deny","reason":"…"}`.
- **Record.** The span has the verdict, the reason, the digest size, the judge's time, `judge_by` for a judged turn, and `jev_p_claim` when Jev answered. The `verified` score is 1 for a pass or a skip, 0 for a deny and 0.5 for a forced pass. A forced pass and a `fail-open` have the level `WARNING`, and a `fail-open` has no score. A turn with no code change posts nothing.

### context gate

`hooks/context-gate.ts`, with its logic in `lib/session-context.ts`, measures fill against the window minus 33k tokens. The window is `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, else `autoCompactWindow` in `~/.claude/settings.json`, else 1M.

- At 0.75 of that threshold, it prints a `systemMessage` warning. `ALEPH_CONTEXT_WARN` (0.75) changes the fraction.
- After the session's first compaction, it blocks once and asks for a handoff.

The measurements and the reason for each decision are in [ADR 0004](adr/0004-context-gate-ends-a-session-early.md).

- **Fill.** The fill is the input, cache-read and cache-creation tokens of the last main-thread assistant request in the transcript.
- **Window.** With the 400k `autoCompactWindow` that ADR 0004 decides, the threshold is 367k and the warning starts at 275k.
- **Warning.** The text is `Context 290k of the 367k budget. /aleph:handoff then /clear keeps the next turn sharp.`, and the turn passes. A session that has compacted gets no warning.
- **Block.** The block is `{decision: "block", reason: "Context gate: …"}`, and its reason asks for the `aleph:handoff` skill and then `/clear`. The gate blocks once per session, marked by the spool file `ctx:<session_id>.json`, and never on a retry (`stop_hook_active`). Only a `compact_boundary` entry or a compact summary counts as a compaction. A `microcompact_boundary` does not.
- **Scope.** The gate runs on the main agent's `Stop` in an interactive session only. In a factory run (`ALEPH_JOB_ID` set) or an SDK session (`CLAUDE_CODE_ENTRYPOINT` starts with `sdk`) it does nothing. It posts no span and no score.

### refit-code

`skills/refit-code/hook.ts` checks the change since the branch left the default branch, plus the working tree. It uses no model. Co-change rules come from `skills/refit-code/cochange.ts`. Boundary rules and new copies of code come from one `jscpd` run (`skills/refit-code/clones.ts`) with `.jscpd.json`, compared with the branch's base. A pair recorded in `.refit.json` under `accepted` does not block. It blocks once per session for one set of findings, and at most 3 times per session in all. If the check throws, it prints a `systemMessage` with the error and does not block. [The refit-code skill](../skills/refit-code/SKILL.md) has the rules.

### handoff-saved

`hooks/handoff-saved.ts` watches `Write`. When the path is `<handoffs>/projects/*.md` or `<handoffs>/projects/<repo>/*.md`, it returns `{continue: false}` with a stop reason that says to run `/clear`.

- Outside Herdr, the stop reason tells the user to run `/clear`, and no process starts.
- Inside Herdr (`HERDR_ENV=1` and `HERDR_PANE_ID` set), when the file is this pane's `<handoffs>/projects/<repo>/<HERDR_PANE_ID>.md`, the stop reason says the session clears and picks up on its own. The hook also starts `hooks/handoff-cycle.ts` detached, so it outlives the hook. That process waits until Herdr reports the pane `idle` or `done` (idle after unseen work, as in an unfocused tab), then runs `herdr agent prompt <pane> /clear --wait` and `herdr agent prompt <pane> "/aleph:pickup <path>" --wait`. A failed step stops the cycle.
- Inside the Herdr desktop app (`HC_TERMINAL_ID` set, no Herdr pane, which wins when both are set), when the file is this terminal's `<handoffs>/projects/<repo>/hc-<HC_TERMINAL_ID>.md`, the stop reason is the same and the detached cycle runs `hc wait <terminal>`, `hc send <terminal> /clear`, `hc wait <terminal>` and `hc send <terminal> "/aleph:pickup <path>"`, in that order. Each `hc send` runs without `HC_TERMINAL_ID` in its environment, so `hc` sends a plain command and does not wrap it in `<hc from="tN">`. A step that exits non-zero stops the cycle.

## Tracing

`hooks/obs.ts` sends OTLP spans to Langfuse (`lib/otlp.ts`). Each user turn is one trace, keyed by the prompt id. Spans cover tools, skills (`skill:<name>`), subagents, model generations with their cost (`lib/pricing.ts`) and text events.

- At `SessionStart` it posts nothing. It saves the session name, tags and directory in the spool.
- At `UserPromptSubmit`, an `N/10` in the prompt becomes a `rating` score on the previous trace.
- At `Stop`, Jev tags the turn's `task_type`.

| Does | Variable | When unset |
|---|---|---|
| Turn tracing on; read from the environment or `~/.aleph/.env` | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Tracing is off |
| The Langfuse server | `LANGFUSE_BASE_URL` | `http://127.0.0.1:3010` |
| The environment label: `headless` or `interactive` | `ALEPH_ENV` | `headless` if an ancestor process is `claude -p`, else `interactive` |
| Hand-off files between hooks; pruned after 1 day | `ALEPH_SPOOL` | `~/.aleph/spool` |
| Claude Code's settings file, which the context gate and the Memory page read | `ALEPH_CLAUDE_SETTINGS` | `~/.claude/settings.json` |

Setup and the trace contents are in [Langfuse](langfuse.md).

## Hooks in factory runs

The judge passes `--setting-sources ""`, so no hook runs inside it. The worker, reviewer, intake, director and monitor runs load user settings, so the plugin's hooks can run there. `ALEPH_JOB_ID` tells a hook that it is in a factory run: `handoff-start` does nothing, and the verify gate ignores `skip verify`.
