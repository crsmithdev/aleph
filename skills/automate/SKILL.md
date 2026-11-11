---
name: automate
description: >
  Automate: search sessions for work to automate: errors that repeat and are
  never fixed (a hook that fails, a gate that blocks good turns, a skill listed
  twice), work done by hand again and again, and the turns one session lost.
  Use when asked what keeps breaking, what to automate, what a session learned,
  or to scan sessions, Langfuse, git or the factory for recurring problems, and
  to fix the findings picked (act). NOT for: one bug (use
  /aleph:diagnosing-bugs), code quality (use /aleph:refit-code).
disable-model-invocation: true
---

# Automate

Search what happened at run time for work an agent or a tool could take over: what keeps going wrong, what
keeps being done by hand, and where a session lost turns. Then fix the findings Chris picks. refit-agents reads
one repo's agent files; automate reads what happened, in every repo on the machine.

The argument sets the scope:

- A window (`3d`, `30d`), or none for 14 days: steps 1 to 5. A **finding** is one cause seen in two or more
  sessions (three for work done by hand). Claude Code deletes transcripts after 30 days by default, so a
  longer window sees less than it says.
- `session [<id>]`, or none at the end of a session: the [Session](#session) steps, for this session or a past
  one.
- `act`, with the findings Chris picks from a report: the [Act](#act) steps.

## Steps

1. **Scan.** Run `bun <skill dir>/scan.ts --days <n>`, and save its JSON in the scratchpad. It reads every
   transcript under `~/.claude/projects` (about 15 s for 14 days). Each finding has a `kind`, a `key`, its
   `count`, `sessions`, `days`, `cli` (sessions that are Chris's; the rest are headless workers), `first`,
   `last`, the raw `sample` and `cwd` of the latest hit, and `ids` (the latest sessions it was seen in). `cut`
   counts the findings past `--top`. The scan leaves out commands that only read and errors with no word in
   them. Drop hits from your own session: its id is in the path of the transcript it writes now. Done when
   the JSON is saved and you have read every finding in it.

   | Kind | Signal |
   |---|---|
   | `hook` | A hook that failed: a non-blocking error, or a PreToolUse hook error |
   | `tool` | A tool result with `is_error` |
   | `gate` | A Stop-hook denial, keyed by the gate's name |
   | `loop` | Three or more denials in a row with no prompt from Chris between them |
   | `dupe` | One skill name listed more than once in a session's skill listing |
   | `reload` | One skill loaded twice in a session |
   | `command` | One Bash command shape in three or more sessions |
   | `prompt` | One prompt from Chris in three or more sessions |

2. **Read the other sources** for the same window. Done when each one has a count or a reason it has none.
   - Git, for each repo in `~/.aleph/repos.json` (an object of name to `{path}`): reverts, and fixes to code
     that landed earlier in the window. Docs-only fixes do not count.
     `jq -r '.[].path' ~/.aleph/repos.json`, then
     `git -C <path> log --since=<n>.days --format='%h %s' -i -E --grep='^(revert|fix)'`
   - Issues: `aleph issue list <repo> --kind bug`. Look for titles that repeat a cause.
   - Factory runs: `find ~/.aleph/runs -name stderr.log -mtime -<n>`. Count repeated error lines, and skip
     lines that every run prints (the connectors notice).
   - Langfuse holds the same turns as the transcripts. Read a trace (`/api/public/observations?traceId=<id>`,
     keys in `~/.aleph/.env`) only when a finding needs the timing or cost of a turn.

3. **Judge each error finding** (`hook`, `tool`, `gate`, `loop`, `dupe`, `reload`, and errors from step 2).
   Read the raw evidence in the `ids` sessions (`~/.claude/projects/*/<id>.jsonl`) until you can name the
   cause. Then decide:
   - **Noise**: a key with no cause in it (`Bash: N`), or a correct refusal (Chris rejected a tool call, a
     test failed while work was in progress). Drop it, and say how many you dropped.
   - **Fixed**: `open` is false when a commit touched a path in the sample after the last hit. Confirm the fix
     in the current code, then drop it. `open` is true by default, so true proves nothing.
   - **Covered**: an open issue names the same cause. Name the issue.
   - **Open**: none of the above. Say whether the current code still produces it (a file still missing, a
     config line still pointing at an old path). Check the checkout at `cwd`, not only main: a stale worktree
     or a session started before a fix keeps an error alive after main is fixed.

   A `gate` or `loop` finding asks whether the gate is wrong, not whether the agent was.
   `jobs/lib/learning/corrections.ts` already turns denials into lessons for the agent. Read three denials
   from the `ids` sessions, the latest in each. For each one, decide whether the claim was unverified (the gate was right) or was
   verified or was not a claim (the gate was too strict).

4. **Judge each repeated-work finding** (`command`, `prompt`). A command that only reads (`sed -n`, `cat`,
   `git diff`) is normal work, not a finding. A command or prompt is a finding when the same steps produce the same
   kind of result each time, or when Chris has to type the same thing to keep the agent moving
   (`continue`, `go`). For a prompt, read the turn before it, and name why the agent stopped.

5. **Report** in the terminal, in two lists: findings in Chris's sessions (`cli` above 0), then findings
   only in headless workers. Rank each list by sessions ×
   the cost of one occurrence (a lost turn, a retry, a nudge from Chris). For each
   finding, give the kind, the key, the count and the sessions, one cited occurrence (a session id and its
   timestamp), and the cause. After that, list the covered findings with
   their issues. Then list the dropped findings as counts per reason, counted with `jq`, not by eye. End with what was not read.

File nothing and change nothing until Chris picks findings for `act`.

## Session

1. **Reflect.** List each place the session lost a turn: a lookup, a guess that failed, a correction from
   Chris, a command found by trial, a gotcha. For a past session, read its transcript
   (`~/.claude/projects/*/<id>.jsonl`), its Langfuse traces, or `vault compile`. Done when each item names the
   turn it cost.
2. **Report** each item in the terminal with the turn it cost and its cause, as in step 5. File and change
   nothing.

## Act

1. **Route.** Each finding goes to one place. Pick the cheapest that removes it:
   - **Code**, when it can carry it (an **interface** finding): a script or CLI subcommand for a fixed
     sequence of commands, a hook for a step that must happen every time, a usage line or an error message.
   - **Permission rule**: a command that Chris approves each time.
   - **Vault** (`aleph:vault`): a fact about the user, or one that holds across repos.
   - **Agent file**: the root memory file when every task needs it, a nested `CLAUDE.md` or a skill when only
     some do. A worker's prompt or schema when only headless workers hit it.

   Done when each finding has one place.
2. **Gate.** Run `/aleph:refit-agents check` on each proposed agent-file line: cut it when the agent can find
   it by looking, write it as a plain imperative with its reason, and make sure it contradicts no line in
   context.
3. **Propose.** Show each change as a diff with a one-line why. Apply only what the user approves; code
   changes go on a branch as usual. Done when each finding is applied, declined, or filed with
   `aleph issue add` (`--kind bug` for an error).
