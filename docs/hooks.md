# Hooks

Aleph registers its hooks in `hooks/hooks.json`. `.claude-plugin/plugin.json` points to that file. Each hook is `bun <script>` against the Claude Code 2.1 hook API. Every script in `hooks/*.ts` is registered. The modules in `hooks/lib/` are helpers, not hooks.

After you change a hook, run `/reload-plugins`.

## Map

| Event | Matcher | Script | Timeout (s) | Does |
|---|---|---|---|---|
| every event | | `obs.ts` | 5–10 | Sends spans to Langfuse |
| `SessionStart` | | `vault-context.ts` | 10 | Injects `MEMORY.md` and the `core:` lines |
| `SessionStart` | `startup\|clear` | `handoff-start.ts` | 10 | Injects a waiting handoff |
| `SessionStart` | | `jobs/cli.ts report --hook` | 20 | Injects the factory report |
| `UserPromptSubmit` | | `verify-gate.ts` | 10 | Snapshots the repo for the Stop check |
| `UserPromptSubmit` | | `vault-recall.ts` | 5 | Injects up to 3 vault notes |
| `PreToolUse` | `Edit\|Write\|NotebookEdit` | `git-guard.ts` | 10 | Denies edits on `main`, in the work store and on `VAULT.md` |
| `PreToolUse` | `Bash` | `secret-scan.ts` | 10 | Denies a commit that adds a secret or a debug leftover |
| `PreToolUse` | `Bash` | `gh-guard.ts` | 15 | Asks before a `gh` write to a repo of another owner |
| `PostToolUse` | `Write` | `handoff-saved.ts` | 10 | Ends the turn after a handoff file is written |
| `Stop` | | `verify-gate.ts` | 45 | Blocks a claim of completion that no run supports |
| `Stop` | | `context-gate.ts` | 10 | Warns on context fill; asks for a handoff after a compaction |

`obs.ts` runs async on every event except `Stop`, `StopFailure` and `SessionEnd`, where it runs inline with a 5-second timeout.

## Failure modes

The three `PreToolUse` guards **fail closed**. `hooks.json` wraps each in `sh -c 'bun "$1" || { …; exit 2; }'`, and each script also catches its own errors and exits 2. A guard that crashes denies the tool call.

All other hooks **fail open**. An error exits without a block, or prints nothing. Without Langfuse keys, `obs.ts` exits silently. Without a vault, `vault-context.ts` prints nothing.

## Context hooks

### vault-context

`hooks/vault-context.ts` injects `additionalContext`: the vault's `MEMORY.md`, then the `core:` lines of the repo's scope and of `global`. `startContext` in `vault/lib/vault.ts` cuts the text to a byte budget. The hook is silent when `<vault>/Home.md` does not exist. `ALEPH_VAULT` sets the vault path (default `~/.aleph/vault`).

### handoff-start

`hooks/handoff-start.ts` looks for `<handoffs>/projects/<repo>.md`. When the file exists, the hook prints a `systemMessage` and tells Claude to run `aleph:pickup`. When the handoff text, `git status` and `git log -5` fit in 10,000 characters, the hook injects them too. `ALEPH_HANDOFFS_DIR` sets the folder (default `~/.aleph/handoffs`). The hook does nothing in a factory run (`ALEPH_JOB_ID` set) or an SDK session.

### aleph report

`aleph report --hook` (`reportCmd` in `jobs/cli.ts`) fetches `origin` for each factory repo, then injects:

- the runs that no session has shown yet;
- how far each checkout is behind `origin/main`;
- health lines, flake lines and the monitor's line.

It prints nothing when it has nothing to say.

### vault-recall

`hooks/vault-recall.ts` skips prompts under 20 characters. It ranks the wiki notes (`rankNotes` in `vault/lib/index.ts`), leaves out core notes and the notes this session has already seen, and asks Jev one yes/no question for each of the top 20, with a 1.5-second timeout. It injects at most 3 notes with p ≥ 0.7. It swallows every error. The judge choice `haiku` turns it off.

## Guards

### git-guard

`hooks/git-guard.ts` returns `permissionDecision: "deny"` for:

- an edit in the work store (`storeDir` in `issues/lib/store.ts`); the reason says to use `aleph issue`;
- an edit of `VAULT.md` in the vault;
- an edit on `main`, `master` or a detached HEAD in a repo's main checkout.

Linked worktrees are allowed. Repos whose top level is `~`, `~/.claude` or `~/.aleph`, and files outside any repo, are exempt. The guard resolves symlinks first.

### secret-scan

`hooks/secret-scan.ts` acts only on a Bash command that runs `git … commit`. It scans the staged diff. With `-a`, `-A` or a `git add` in the command, it also scans the unstaged diff and the untracked files under 1 MB.

The rules in `hooks/lib/scan.ts` find AWS, Anthropic, Langfuse, OpenAI-style `sk-`, GitHub, Slack and Google keys, private keys, JWTs, a generic credential assignment of 16 or more characters, and the debug leftovers `debugger`, `pdb`, `pry` and `.only(`. A finding denies the commit. A `cd` or `-C` to a directory the guard cannot resolve also denies.

To skip the scan, put `ALEPH_SKIP_SCAN=1` in the command text.

### gh-guard

`hooks/gh-guard.ts` finds `gh` writes: a write verb (`gh pr create`, `gh issue comment`, …) or a `gh api` call with a non-GET method, `-f`/`-F` fields or a `mutation`. It finds the owner from `-R`/`--repo`, a github.com URL, `repos/<owner>/`, or the `origin` of the directory after each `cd`. When the owner is not the user, or the guard cannot find the owner, it returns `permissionDecision: "ask"`. The user is `ALEPH_GH_USER`, else `gh api user -q .login`: the login that command prints.

## Gates

### verify gate

`hooks/verify-gate.ts` runs twice per turn. At `UserPromptSubmit` it snapshots the repo and its worktrees into the spool (`hooks/lib/snapshot.ts`). At `Stop` it compares, and decides in this order:

1. No code file changed (`.md` and `.mdx` do not count): pass.
2. The prompt says `skip verify`: pass. Factory runs cannot use this.
3. The gate has denied twice this turn: pass.
4. The final message cites a commit hash that the turn never showed: deny (`hooks/lib/hashes.ts`).
5. The final message says a doc matches the code with no run, value or `file:line` behind it: deny (`hooks/lib/docclaims.ts`).
6. Else the judge decides (see [Routing](routing.md#judge)).

A deny is `{decision: "block", reason: "Verify gate: …"}`. A judge that cannot answer passes the turn as `fail-open`. Each outcome posts a `guardrail` span and a `verified` score to Langfuse. The design and the evidence are in [the verify gate decision](verify-gate.md).

### context gate

`hooks/context-gate.ts`, with its logic in `hooks/lib/context.ts`, measures fill against the window minus 33k tokens. The window is `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, else `autoCompactWindow` in `~/.claude/settings.json`, else 1M.

- At 0.75 of that threshold, it prints a `systemMessage` warning. `ALEPH_CONTEXT_WARN` (0.75) changes the fraction.
- After the session's first compaction, it blocks once and asks for a handoff.

The design is in [the context gate decision](context-gate.md).

### handoff-saved

`hooks/handoff-saved.ts` watches `Write`. When the path is `<handoffs>/projects/*.md`, it returns `{continue: false}` with a stop reason that says to run `/clear`.

## Tracing

`hooks/obs.ts` sends OTLP spans to Langfuse (`lib/otlp.ts`). Each user turn is one trace, keyed by the prompt id. Spans cover tools, skills (`skill:<name>`), subagents, model generations with their cost (`lib/pricing.ts`) and text events.

- At `SessionStart` it posts nothing. It saves the session name, tags and directory in the spool.
- At `UserPromptSubmit`, an `N/10` in the prompt becomes a `rating` score on the previous trace.
- At `Stop`, Jev tags the turn's `task_type`.

| Does | Variable | When unset |
|---|---|---|
| Turn tracing on; read from the environment or `~/.aleph/.env` | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Tracing is off |
| The Langfuse server | `LANGFUSE_BASE_URL` | `http://127.0.0.1:3010` |
| The environment label: `headless` or `interactive` | `ALEPH_ENV` | `ALEPH_ENV`, else `interactive`; `headless` when an ancestor process is `claude -p` |
| Hand-off files between hooks; pruned after 1 day | `ALEPH_SPOOL` | `ALEPH_SPOOL`, else `~/.aleph/spool` |

Setup and the trace contents are in [Langfuse](langfuse.md).

## Hooks in factory runs

The judge and the title writer pass `--setting-sources ""`, so no hook runs inside them. The worker, reviewer, intake, director and monitor runs load user settings, so the plugin's hooks can run there. `ALEPH_JOB_ID` tells a hook that it is in a factory run: `handoff-start` does nothing, and the verify gate ignores `skip verify`.
