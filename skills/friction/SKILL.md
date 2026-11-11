---
name: friction
description: >
  Friction: find errors that repeat across sessions and are never fixed (a hook
  that fails, a gate that blocks good turns, a skill listed twice), and work
  done by hand again and again that a script, skill, hook or rule could do. Use
  when asked what keeps breaking, what to automate, or to scan sessions,
  Langfuse, git or the factory for recurring problems. NOT for: one bug (use
  /aleph:diagnosing-bugs), code quality (use /aleph:refit-code), one repo's
  agent files or one session's lessons (use /aleph:refit-agents).
disable-model-invocation: true
---

# Friction

Find what keeps going wrong and what keeps being done by hand, and say what fix stops each one. Code counts;
you judge. A **finding** is one cause seen in two or more sessions (three for work done by hand).

The input is what happened at run time, in every repo on the machine. refit-agents reads one repo's agent
files and asks whether they are good; its `learn` mode reflects on one session. Friction counts across all
sessions, and most of its fixes land in code, hooks and config, not in agent files. A fix that adds a line to
an agent file goes through `/aleph:refit-agents check` before it lands.

The argument is a window: `3d`, `30d`. With no argument, the window is 14 days. Claude Code deletes
transcripts after 30 days by default, so a longer window sees less than it says.

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
   `git diff`) is normal work, not friction. A finding is friction when the same steps produce the same
   kind of result each time, or when Chris has to type the same thing to keep the agent moving
   (`continue`, `go`). For a prompt, read the turn before it. Name the cheapest fix that removes it:
   - **Script or CLI subcommand**: a fixed sequence of commands.
   - **Hook**: a step that must happen every time.
   - **Permission rule**: a command that Chris approves each time.
   - **Skill**: a workflow that needs judgement.
   - **Rule** in a CLAUDE.md: an agent behaviour, such as stopping early.

5. **Report** in the terminal, in two lists: findings in Chris's sessions (`cli` above 0), then findings
   only in headless workers, whose fix is usually in a worker prompt or schema. Rank each list by sessions ×
   the cost of one occurrence (a lost turn, a retry, a nudge from Chris). For each
   finding, give the kind, the key, the count and the sessions, one cited occurrence (a session id and its
   timestamp), the cause, and the fix with the file it changes. After that, list the covered findings with
   their issues. Then list the dropped findings as counts per reason, counted with `jq`, not by eye. End with what was not read.

File nothing and change nothing until Chris picks findings. Then file each pick with `aleph issue add`
(`--kind bug` for an error).
